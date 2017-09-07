var logger = require('winston');
var profileSource = require('./ConstDefined').ProfileSource;
var profileBit = require('./ConstDefined').ProfileBit;
var sex = require('./ConstDefined').Sex;
var Profile = require('./model/Models').model('Profile');
var _ = require('underscore');
var Long = require('mongodb').Long;
var photoManager = require('./PhotoManager');
var async = require('async');
var relationManager = require('./RelationManager');
var GET_PROFILE_LIMIT;
var SEARCH_LIMIT;

var init = function(config) {
	GET_PROFILE_LIMIT = config.get_profile_limit;
	SEARCH_LIMIT = config.search_limit;
};

var update = function(req, res) {
	var uid = Number(req.body.uid);
	var source = Number(req.body.source);

	if (!source || !_.contains(_.values(profileSource), source)) {
		return res.status(400).send();
	}

	async.series({
		photoPath: function(cb) {
			if (req.body.photoUrl && source === profileSource.THIRD_PARTY) {
				photoManager.transferPhoto(uid, req.body.photoUrl, cb);
			} else {
				cb(null);
			}
		}
	}, function(err, result){
		if (err) {
			return res.status(500).send();
		}

		if (result.photoPath) {
			req.body.photoPath = result.photoPath;
		}

		doUpdate(uid, req.body, source, function(err, result){
			if (err) {
				if (err.message === "empty content to update") {
					return res.status(400).send();
				} else {
					return res.status(500).send();
				}
			}

			if (result.updated) {
				res.json({
		            success: true,
		            photoPath: req.body.photoPath // if photo updated, return new url
		        });
			} else {
				res.json({
		            success: false,
		            error: 1,
		            errMsg: 'nothing updated'
		        });
			}
		});
	});
};

var doUpdate = function(uid, content, source, callback) {
	var value = {};
	var bits = Long.fromNumber(0).getLowBitsUnsigned();

	if (content.nick) {
		value.nick = content.nick;
		bits = bits | profileBit.NICK;
	}
	if (content.sex && _.contains(_.values(sex), content.sex)) {
		value.sex = Number(content.sex);
		bits = bits | profileBit.SEX;
	}
	if (content.signature) {
		value.signature = content.signature;
		bits = bits | profileBit.SIGNATURE;
	}
	if (content.photoPath) {
		value.photoPath = content.photoPath;
		bits = bits | profileBit.PHOTO_PATH;
	}
	if (_.isEmpty(value)) {
		callback(new Error('empty content to update'));
		return;		
	}

	var bitsOperation;
	if (source === profileSource.THIRD_PARTY) {
		bits = ~ bits;
		bits = bits & (~(Long.fromNumber(1).getLowBitsUnsigned() << 31)); // keep bits as positive
		bitsOperation = {source: { and: bits }};
	} else {
		bitsOperation = {source: { or: bits }};
	}

	// update profile
	var query = {_id: uid};
	var update = {
		"$set": value,
		"$bit": bitsOperation
	};
	Profile.update(query, update, {upsert: false, multi: false}, function(err, result){
		logger.info('doUpdate [%s]\'s profile %s, source bit operation:{%s:%s}, result:%s', uid, JSON.stringify(value), 
			(source === profileSource.THIRD_PARTY ? "and" : "or"), bits.toString(2), JSON.stringify(err ? err : result));

		if (err) {
			callback(err);
			return;
		}

		callback(null, {updated: result.nModified > 0});
	});
};

var uploadPhoto = function(req, res) {
    var uid = Number(req.body.uid);
    var source = Number(req.body.source);

    if (!source || !_.contains(_.values(profileSource), source)) {
        return res.status(400).send();
    }

    if (!req.files || !req.files.photo) {
        return res.status(400).send('No file uploaded');
    }

    if (!endsWith(req.files.photo.name, ".jpg")) {
        return res.status(400).send('Invalid format');
    }

    var timestamp = new Date().getTime();
    var filePath = req.files.photo.path;

    var storePath = uid +'/' + timestamp+'/';
    var destName = storePath+'0.jpg';

    async.series([
    		function(cb) {
				photoManager.uploadToS3(filePath, destName, cb);
    		},
            function(cb) {
            	doUpdate(uid, {photoPath : storePath}, source, cb);
            }
        ],
        function(err, result) {
            if (err) {
                logger.error('uid:[%s] upload profile pic failed', uid, err);
                res.status(500).send();
                return;
            }

            setTimeout(photoManager.cleanUp(req.files), 10);

            logger.info('uid:[%s] upload profile pic success', uid, JSON.stringify(result));

            res.status(200).json({
                'success': true,
                'photoPath': storePath
            });
        }
    );
};

var get = function(req, res) {
	var uid = Number(req.body.uid);
	var users = JSON.parse(req.body.users);
	users = users.slice(0, 50);

	if (!users || !users.length === 0) {
		return res.status(400).send();
	}

	async.parallel({
		profiles: function(cb) {
			var query = users.map(function(user) {
				var v = user.v ? user.v : -1;
				return {
					'_id': Number(user.uid), 
					'__v': {"$gt": v}
				}
			});

			Profile.find({"$or" : query}, function(err, docs) {
				logger.debug('[%s] get profiles of users:%s, result:%s', uid, JSON.stringify(users), JSON.stringify(err ? err : docs));

				if (err) {
					cb(err);
					return;
				}

				var profiles = docs.map(function(doc) {
					var profile = {
						uid: doc._id,
						nick: doc.nick,
						sex: doc.sex,
						signature: doc.signature,
						photoPath: doc.photoPath,
						subTo : doc.subTo,
						subed : doc.subed,
						v: doc.__v,
					};
					if (profile.uid === uid) {
						profile.source = doc.source;
					}
					return profile;
				});

				cb(null, profiles);
			});
		},
		subTo: function(cb) {
			var uids = users.map(function(user) {
				return user.uid;
			});
			relationManager.filterSubTo(uid, uids, cb);
		}
	}, function(err, results){
		if (err) {
			return res.status(500).send();
		}
		results.success = true;
		res.json(results);
	});
}

var getBrief = function(uids, callback) {
	Profile.find({"_id" : {"$in" : uids}}, function(err, docs) {
		if (err) {
			callback(err);
			return;
		}

		var profiles = docs.map(function(doc) {
			var profile = {
				uid: doc._id,
				nick: doc.nick,
				photoPath: doc.photoPath
			};
			return profile;
		});

		callback(null, profiles);
	});
}

var search = function(req, res){
	var uid = Number(req.query.uid);
	var nick = req.query.nick;
	var from = Number(req.query.from);
	var to = Number(req.query.to);

	if (!nick) {
		return res.status(400).send();
	}
	if (!from) {
		from = 0;
	}
	if (!to && to !== 0) {
		to = SEARCH_LIMIT;
	}

	Profile.find({nick: {"$regex": nick, "$options": 'i'}}, function(err, docs) {
		if (docs) {
			var slice = docs.slice(from, to + 1);
			logger.debug('search profile', from, to, JSON.stringify(slice));
		}

		logger.info('[%s] search profiles with nick %s, result:%s', uid, nick, JSON.stringify(err ? err : slice.map(function(doc){return doc._id})));

		if (err) {
			return res.status(500).send();
		}

		var profiles = [];
		var users = [];

		_.each(slice, function(doc) {
			profiles.push({
				uid: doc._id,
				nick: doc.nick,
				photoPath: doc.photoPath
			});
			users.push(doc._id);
		});

		relationManager.filterSubTo(uid, users, function(err, subTo){
			if (err) {
				return res.status(500).send();
			}

			res.json({
	            success: true,
	            profiles: profiles,
	            subTo: subTo
	        });
		});
	});
}

var endsWith = function(str, suffix) {
    return str.slice(-suffix.length) === suffix;
}

// to solve curcular dependency, place exports here
module.exports = {
	init : init,
	update: update,
	get : get,
	getBrief: getBrief,
	search: search,
	uploadPhoto: uploadPhoto
}
