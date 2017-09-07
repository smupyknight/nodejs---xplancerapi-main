var logger = require('winston');
var _ = require('underscore');
var async = require('async');
var PeriodicUniqIdGenerator = require('./utils/PeriodicUniqIdGenerator');
var roomFilter = require('./ConstDefined').RoomFilter;
var roomRole = require('./ConstDefined').RoomRole;
var ServerMsgType = require('./ConstDefined').ServerMsgType;
var tokenManager = require('./TokenManager');
var relationManager = require('./RelationManager');
var config = require('config');
var DynamicKey4 = require('./utils/DynamicKey4');
var signalManager = require('./SignalManager');
var Profile = require('./model/Models').model('Profile');
var profileManager = require('./ProfileManager');
var redis;
var ridGenerator;

// constant defined in config file
var GET_ROOM_LIMIT;

var GET_USERS_IN_LIMIT;

var CAL_HOT_AUDIENCE_MODE;


// REDIS DATA STRUCTURE

// 1: h_room_<rid>:
//      {id
//      name (optional)
//      creator
//      createTime
//      password (optional)}

// 2: s_audience_<rid>: [uid]

// 3: ss_room_create_time: <rid, createTime>

// 4: ss_room_hot_value: <rid, hotValue>

// 5: k_user_cur_room_<uid>: rid

// 6: s_creator: [uid]


var SSKEY_ROOM_CREATE_TIME = 'ss_room_create_time';
var SSKEY_ROOM_HOT_VALUE = 'ss_room_hot_value';
var S_CREATOR = 's_creator';

var getHRoomKey = function(rid) {
	return 'h_room_' + rid;
}

var getSAudienceKey = function(rid) {
	return 's_audience_' + rid;
}

var getKUserCurRoom = function(uid) {
	return 'k_user_cur_room_' + uid;
}

var init = function(redisClient) {
    redis = redisClient;
    ridGenerator = new PeriodicUniqIdGenerator('roomId');
    GET_ROOM_LIMIT = config.RoomController.get_room_limit;
    GET_USERS_IN_LIMIT = config.RoomController.get_users_in_limit;
    CAL_HOT_AUDIENCE_MODE = config.RoomController.cal_hot_audience_mode;
}


var create = function(req, res) {
	var uid = req.body.uid;
	var name = req.body.name;
	var pwd = req.body.pwd;

    if (!uid) {
        return res.status(400).send();
    }

    _leaveCurRoom(uid, null, function(err, result){
    	if (err) {
    		logger.error('error _leaveCurRoom ', err);
    		return res.status(500).send();
    	}
    	if (result) logger.info('[%s] leave previous room before CREATE:', uid, JSON.stringify(result));

    	profileManager.getBrief([uid], function(err, profiles){ // if err, still create room
	    	// do create room
	   		var rid = ridGenerator.nextId().toString();
	    	var now = new Date().getTime();
	    	var profile = profiles ? profiles[0] : null;

			var hash = {
				id: rid,
				creator: uid,
				createTime: now,
			};
			if(name) hash['name'] = name;
			if(pwd) hash['pwd'] = pwd;
			if(profile && profile.nick) hash['creatorNick'] = profile.nick;
			if(profile && profile.photoPath) hash['creatorPhotoPath'] = profile.photoPath;

			var multi = redis.multi();
			multi.hmset(getHRoomKey(rid), hash);
			multi.set(getKUserCurRoom(uid), rid);
			multi.zadd(SSKEY_ROOM_CREATE_TIME, now, rid);
			multi.zadd(SSKEY_ROOM_HOT_VALUE, 0, rid); // log10(1) = 0;
			multi.sadd(S_CREATOR, uid);

			multi.exec(function(err, result){
		    	if (err){
		            logger.error('error create room', err);
		            return res.status(500).send();
		        }

		        // server join channel
		        signalManager.joinChannel(rid);

		       	var channelKey = generateChannelKey(rid, now, uid);

		        logger.info('[%s] create room %s: %s, channelKey:%s', uid, rid, JSON.stringify(hash), channelKey);

				res.json({success: true, 
					room: {
						id: rid,
						name: hash.name,
						creator: {
							uid: Number(hash.creator),
							nick: hash.creatorNick,
							photoPath: hash.creatorPhotoPath
						},
						createTime: Number(hash.createTime),
						hasPwd: hash.pwd ? true : false,
						audience: 0
					},
					channelKey: channelKey
				});
			});
    	});
    });
}

var join = function(req, res){
	var uid = req.body.uid;
	var rid = req.body.rid;
	var pwd = req.body.pwd;

    if (!uid || !rid) {
        return res.status(400).send();
    }

    _leaveCurRoom(uid, rid, function(err, result){
    	if (err) {
    		logger.error('error _leaveCurRoom ', err);
    		return res.status(500).send();
    	}
    	if (result) logger.info('[%s] leave previous room before JOIN:', uid, JSON.stringify(result));

    	// do join
	    var roomKey = getHRoomKey(rid);
	    var audienceKey = getSAudienceKey(rid);

	    var multi = redis.multi();
	    multi.hgetall(roomKey);
	    multi.sismember(audienceKey, uid);
	    multi.scard(audienceKey);

	    multi.exec(function(err, mRes){
	    	if (err) {
				return res.status(500).send();
			}

			var room = mRes[0];
			var isMember = mRes[1];
			var audience = mRes[2] + (isMember ? 0 : 1);
			var count = audience + 1;

			if (room) {
				if (room.creator === uid) { // creator rejoin his room, for channel key
					var channelKey = generateChannelKey(room.id, new Date(), uid);

					logger.info('[%s] re-joined room %s, channelKey: ', uid, room.id, channelKey);

					return res.json({success: true, 
						room:{
							id: room.id,
							name: room.name,
							creator: {
								uid: Number(room.creator),
								nick: room.creatorNick,
								photoPath: room.creatorPhotoPath
							},
							createTime: Number(room.createTime),
							hasPwd: room.pwd ? true : false,
							audience: audience
						},
						channelKey: channelKey
					});
				}

				if (room.pwd === pwd) {
					var multi = redis.multi();
					multi.set(getKUserCurRoom(uid), rid);
					multi.sadd(audienceKey, uid);
					if (count % CAL_HOT_AUDIENCE_MODE === 0) {
						// only when count % CAL_HOT_AUDIENCE_MODE === 0, re-calculate hot value. use this to reduce calculation.
						multi.zadd(SSKEY_ROOM_HOT_VALUE, Math.log10(count), rid); 
					}

					multi.exec(function(err, result){
				    	if (err) {
							return res.status(500).send();
						}

				       	var channelKey = generateChannelKey(rid, new Date(), uid);

						logger.info('[%s] joined room %s, channelKey: ', uid, rid, channelKey);

						res.json({success: true, 
							room:{
								id: rid,
								name: room.name,
								creator: {
									uid: Number(room.creator),
									nick: room.creatorNick,
									photoPath: room.creatorPhotoPath
								},
								createTime: Number(room.createTime),
								hasPwd: room.pwd ? true : false,
								audience: audience
							},
							channelKey: channelKey
						});

						profileManager.getBrief([uid], function(err, profiles) {
							if (err) {
								return res.status(500).send();
							}

							signalManager.sendChannelMsg(rid, JSON.stringify({
								'type': ServerMsgType.CHANNEL_USER_JOINED,
								'rid': rid,
								'user': profiles[0]
							}));							
						});
				    });
				} else {
					logger.info('user [%s] join room %s, with incorrect password %s', uid, rid, pwd);
					res.json({success: false, error: 2, errMsg: 'incorrect password'});	
				}
			} else {
				logger.info('user [%s] join room %s which not exist', uid, rid);
				res.json({success: false, error: 1, errMsg: 'room not exist'});	
			}
		});
	});
};


var leave = function(req, res){
	var uid = req.body.uid;
	var rid = req.body.rid;

    if (!uid || !rid) {
        return res.status(400).send();
    }

    _leave(uid, rid, function(err, result){
    	if (err) {
    		return res.status(500).send();
    	}

	    logger.info('[%s] leave %s result: ', uid, rid, JSON.stringify(result)); 

    	res.json(result);
    });
}

var _leave = function(uid, rid, callback) {
    var roomKey = getHRoomKey(rid);
    var audienceKey = getSAudienceKey(rid);

    var multi = redis.multi();
    multi.hgetall(roomKey);
    multi.sismember(audienceKey, uid);
    multi.scard(audienceKey);
    multi.exec(function(err, res){
    	if (err) {
			callback(err);
			return;
		}

		var room = res[0];
		var isMember = res[1];
		var audience = res[2] - (isMember ? 1 : 0);
		var count = audience + 1;

		if (room) {
			if (Number(room.creator) === Number(uid)) {
				logger.info('creator [%s] _leave, destroy room', uid, rid);

				var multi = redis.multi();
				multi.del(roomKey);
				multi.del(audienceKey);
				multi.del(getKUserCurRoom(uid));
				multi.zrem(SSKEY_ROOM_CREATE_TIME, rid);
				multi.zrem(SSKEY_ROOM_HOT_VALUE, rid);
				multi.srem(S_CREATOR, uid);

				multi.exec(function(err, result){
					if (err) {
						callback(err);
						return;
					}
					callback(null, {success: true});
				});

				signalManager.leaveChannel(rid);
			} else {
				logger.info('audience [%s] _leave', uid, rid);

				var multi = redis.multi();
				multi.srem(audienceKey, uid);
				multi.del(getKUserCurRoom(uid));
				if (count % CAL_HOT_AUDIENCE_MODE === 0) {
					multi.zadd(SSKEY_ROOM_HOT_VALUE, Math.log10(count), rid); 
				}

				multi.exec(function(err, result){
					if (err) {
						callback(err);
						return;
					}
					callback(null, {success: true});
				});
			}
		} else {
			logger.info('[%s] _leave room %s which not exist', uid, rid);
			callback(null, {success: false, error: 1, errMsg: 'room not exist'});
		}
    });
}

var get = function(req, res) {
	var uid = Number(req.query.uid);
	var token = req.header('token');
	var type = Number(req.query.type);

	var from = Number(req.query.from);
	if (!from) {
		from = 0; // the first one
	}

	var to = Number(req.query.to);
	if (!to) {
		to = -1; // the last one
	}

	// check type
	if (!type || !_.contains(_.values(roomFilter), type)) {
		return res.status(400).send("invalid type");
	}

	// check auth manually
	if (type !== roomFilter.ALL && type !== roomFilter.HOT) {
		if (!uid || !token) {
			return res.status(400).send('Invalid identity');
		} else if (!tokenManager.auth(uid, token)) {
			return res.status(401).send('Invalid user/token');
		}
	}

	if (type !== roomFilter.SPECIFIC) {
		logger.info('[%s] get rooms of type %s, from %s to %s', uid, type, from, to);
	}

	if (type === roomFilter.ALL) {
		redis.zrevrange(SSKEY_ROOM_CREATE_TIME, from, to, function(err, roomIds){
			if (err) {
				return res.status(500).send();
			}

			_get(roomIds.slice(0, GET_ROOM_LIMIT), function(err, rooms){
				if (err) {
					return res.status(500).send();
				}

				res.json({success: true, rooms: rooms});
			});
		});
	} else if (type === roomFilter.HOT) {
		redis.zrevrange(SSKEY_ROOM_HOT_VALUE, from, to, function(err, roomIds){
			if (err) {
				return res.status(500).send();
			}

			_get(roomIds.slice(0, GET_ROOM_LIMIT), function(err, rooms){
				if (err) {
					return res.status(500).send();
				}

				res.json({success: true, rooms: rooms});
			});
		});
	} else if (type === roomFilter.SUBSCRIBED) {
		async.parallel({
			roomIdsSubed: function(callback) {
				relationManager.getAllUidsSubscribeTo(uid, function(err, subscribed) {
					if (err) {
						callback(err);
						return;
					}

					redis.smembers(S_CREATOR, function(err, creators) {
						if (err) {
							callback(err);
							return;
						}

						var creatorsSubed = _.intersection(subscribed, creators.map(Number));
						var roomkeySubed = creatorsSubed.map(getKUserCurRoom);

						if (creatorsSubed.length > 0) {
							redis.mget(roomkeySubed, function(err, roomIdsSubed) {
								if (err) {
									callback(err);
									return;
								}
								callback(null, roomIdsSubed);
							});
						} else {
							callback(null, []);
						}
					});
				});
			},
			allRoomIdsSorted: function(callback) {
				redis.zrevrange(SSKEY_ROOM_CREATE_TIME, 0, -1, function(err, allRoomIdsSorted){
					if (err) {
						callback(err);
						return;
					}
					callback(null, allRoomIdsSorted);
				});
			}
		}, function(err, results){
			var rIdsSubedSorted = _.intersection(results.roomIdsSubed, results.allRoomIdsSorted); // intersection of roomIdsSubed and allRoomIdsSorted
			var toIndex = (to == -1 ? rIdsSubedSorted.length : to);
			var slice = rIdsSubedSorted.slice(from, Math.min(toIndex, GET_ROOM_LIMIT));

			_get(slice, function(err, rooms){
				if (err) {
					return res.status(500).send();
				}

				res.json({success: true, rooms: rooms});
			});
		});
	} else if (type === roomFilter.SPECIFIC) {
		var roomIds = req.query.rIds;
		if (!roomIds) {
	        return res.status(400).send();
		}

		logger.info('[%s] get rooms of type %s:', uid, type, JSON.stringify(roomIds));

		roomIds = _.uniq(roomIds);

		_get(roomIds.slice(0, GET_ROOM_LIMIT), function(err, rooms){
			if (err) {
				return res.status(500).send();
			}

			res.json({success: true, rooms: rooms});
		});
	}
}

var _get = function(rids, callback){
	var multi = redis.multi();
	for (var i = 0; i < rids.length; i++) {
		var rid = rids[i];
	    multi.hgetall(getHRoomKey(rid));
	    multi.scard(getSAudienceKey(rid));
	}

	multi.exec(function(err, data){
		if (err) {
			callback(err);
			return;
		}

		var rooms = [];

		for (var i = 0; i < data.length / 2; i ++) {
			var room = data[2 * i];
			var audience = data[2 * i + 1];

			if (room) {
				rooms.push({
					id: room.id,
					name: room.name,
					creator: {
						uid: Number(room.creator),
						nick: room.creatorNick,
						photoPath: room.creatorPhotoPath
					},
					createTime: Number(room.createTime),
					hasPwd: room.pwd ? true : false,
					audience: audience
				});
			}
		}

		callback(null, rooms);
	});
}

var getUsersIn = function(req, res) {
	var uid = Number(req.query.uid);

	var users = req.query.users.map(Number);
	
	if (!users) {
		users = [uid];
	}

	users = _.uniq(users);

	doGetUsersIn(users, function(err, usersIn){
		logger.debug('[%s] getUsersIn, users: %s, result:', uid, JSON.stringify(users), (err ? err : JSON.stringify(usersIn)));
		
		if (err) {
			return res.status(500).send();
		}

		var rids = usersIn.map(function(userIn) {
			return userIn.rid;
		});

		_get(rids, function(err, rooms) {
			var i = usersIn.length;
			while (i --) {
				var userIn = usersIn[i];

				var room = _.find(rooms, function(room) {
					return room.id === userIn.rid;
				});

				if (room) {
					delete userIn.rid;
					userIn.room = room;
				} else {
					usersIn.splice(i, 1);
				}
			}
			res.json({success: true, usersIn: usersIn});
		});
	});
}

var doGetUsersIn = function(users, callback) {
	var multi = redis.multi();
	for (var i = 0; i < users.length && i < GET_USERS_IN_LIMIT; i++) {
		multi.get(getKUserCurRoom(users[i]));
	}
	multi.smembers(S_CREATOR);

	multi.exec(function(err, mRes){
		if (err) {
			callback(err);
			return;
		}

		var count = mRes.length - 1;
		var creators = mRes[mRes.length - 1];

		var usersIn = [];

		for (var i = 0; i < count; i++) {
			var user = users[i];
			var rid = mRes[i];

			if (rid) {
				usersIn.push({
					uid: user,
					rid: rid,
					role: (_.contains(creators.map(Number), user) ? roomRole.CREATOR : roomRole.AUDIENCE)
				});
			}
		}

		callback(null, usersIn);
	});
}

var userDrop = function(uid, callback) {
	logger.debug('[%s] drop', uid);

	redis.get(getKUserCurRoom(uid), function(err, rid) {
		if (err) {
			callback(err);
			return;
		}

		if (rid) {
			_leave(uid, rid, function(err, result) {
				if (err) {
					callback(err);
					return;
				}

				callback(null, {room: rid, success: result.success});
			});
		} else {
			callback(null, {});
		}
	});
}

var _leaveCurRoom = function(uid, newRid, callback) {
    redis.get(getKUserCurRoom(uid), function(err, rid) {
    	if (err) {
			callback(err);
			return;	
    	}

    	if (rid && rid !== newRid) {
    		_leave(uid, rid, function(err, result) {
    			if (err) {
    				callback(err);
    				return;
    			}

    			callback(null, {rid: rid, success: result.success});
    		});
    	} else {
    		callback(null);
    	}
    });
}

var generateChannelKey = function(rid, nowMs, uid) {
	var appID  = config.AppInfo.app_id;
	var appCertificate = config.AppInfo.app_certificate;
	var ts = Math.floor(nowMs / 1000);
	var r = Math.floor(Math.random() * 0xFFFFFFFF);
	var expiredTs = 0;

	var channelKey = DynamicKey4.generateMediaChannelKey(appID, appCertificate, rid, ts, r, uid, expiredTs);

	return channelKey;
}


module.exports = {
	init : init,
	create : create,
	join : join,
	leave : leave,
	get : get,
	getUsersIn : getUsersIn,
	doGetUsersIn : doGetUsersIn,
	userDrop : userDrop
}

