var logger = require('winston');
var Relation = require('./model/Models').model('Relation');
var Profile = require('./model/Models').model('Profile');
var relations = require('./ConstDefined').Relations;
var relationActions = require('./ConstDefined').RelationActions;
var async = require('async');
var config = require('config').RelationManager;
var _ = require('underscore');


var update = function(req, res) {
	var uid = Number(req.body.uid);
	var data = JSON.parse(req.body.data);

	// check parameter
	if (!uid || !data || data.length === 0) {
		res.status(400).send();
		return;
	}

	var result = {};

	var alluids = [];

	async.eachSeries(_.sortBy(data, 'type'), function(datum, callback){
		if (datum.type === relationActions.UNSUBSCRIBE) {
			var uids = _.uniq(datum.uids);
			alluids = _.union(uids, alluids);

			var bulk = Relation.collection.initializeUnorderedBulkOp();

			for (var i = 0; i < uids.length; i++) {
				var user = uids[i];

				bulk.find({subject: uid, object: Number(user), verb: relations.SUBSCRIBE_TO}).remove();
			}

			bulk.execute(function(err, bulkResult){
				result.unsubed = bulkResult ? bulkResult.nRemoved : 0;
				callback();
			});
		} else if (datum.type === relationActions.SUBSCRIBE) {
			Relation.count({subject: uid, verb: relations.SUBSCRIBE_TO}, function(err, count){
				if (err) {
					callback(err);
					return;
				}

				var uids = _.uniq(datum.uids);
				alluids = _.union(uids, alluids);

				// check subscribe limit
				if (count + uids.length > config.subscribe_limit) {
					callback(1);
					return;
				}

				var bulk = Relation.collection.initializeUnorderedBulkOp();
				
				for (var i = 0; i < uids.length; i++) {
					var user = uids[i];
					bulk.insert({subject: uid, verb: relations.SUBSCRIBE_TO, object: Number(user)});
				}

				bulk.execute(function(err, bulkResult){
					result.subed = bulkResult ? bulkResult.nInserted : 0;
					callback();
				});
			});
		} else {
			callback(400);
		}
	}, function(err) {
		logger.info("[%s] update relations %s, result:", uid, JSON.stringify(data), (err ? err : JSON.stringify(result)));

		if (err) {
			if (err === 400) {
				return res.status(400).send("invalid type");
			} else if (err === 1) {
				return res.json({
		            success: false,
		            error: 1,
		            errMsg: 'out of subscription limit'
		        });
			} else {
				return res.status(500).send();
			}
		} else {
			res.json({
	            success: true,
	            result: result
	        });

			// TODO: aync execute this task
			// update profiles' subed count if necessary
			var bulk = Profile.collection.initializeUnorderedBulkOp();
	        
	        var change = (result.subed ? result.subed : 0) - (result.unsubed ? result.unsubed : 0);
	        if (change !== 0) {
	        	bulk.find({'_id' : uid}).update({'$inc': {'subTo' : change, '__v' : 1}});
	        }

	        if (alluids.length > 0) {
	        	Relation.collection.aggregate([{
	        		'$match' : {
	        			'verb' : relations.SUBSCRIBE_TO,
	        			'object' : {"$in" : alluids}
	        		}
	        	}, {
	        		'$group' : {'_id' : '$object', subed : {'$sum' : 1}}
	        	}], function(err, users) {
	        		logger.debug('aggregate', users);

	        		_.each(alluids, function(uid){
	        			var user = _.find(users, function(user){
	        				return user._id === uid;
	        			});
	        			if (!user) {
	        				user = { _id: uid, subed : 0};
	        			}

	        			if (user.subed < 100) {
	        				var updateProfile = true;
	        			} else {
		        			var n = Math.floor(Math.log10(user.subed));
		        			var updateProfile = (user.subed % Math.pow(10, n - 1) === 0);
	        			}

	        			logger.debug('updateProfile', user, updateProfile);

	        			if (updateProfile) {
	        				bulk.find({'_id' : user._id, 'subed' : {'$ne' : user.subed}}).update({'$set': {'subed' : user.subed}, '$inc' : {'__v' : 1}});
	        			}
	        		});

					bulk.execute(function(err, bulkResult){
						logger.debug('Profile subscription count modified: ', bulkResult.nModified);
					});
	        	});
	        }
		}
	});
}

var get = function(req, res) {
	var uid = Number(req.query.uid);
	var user = Number(req.query.user);
	var type = Number(req.query.type);
	var from = req.query.from;
	var to = req.query.to;

	if (!uid || !user || !type || !_.contains(_.values(relations), type)) {
		return res.status(400).send();
	}

	if (!from) {
		from = 0;
	}
	if (!to) {
		to = config.get_limit;
	}

	var _get;

	switch(type) {
		case relations.SUBSCRIBE_TO:
			_get = _getUidsSubscribeTo;
			break;
		case relations.BE_SUBSCRIBED:
			_get = _getUidsBeSubscribed;
			break;
	}

	_get(user, from, to, function(err, uids) {
		logger.info("[%d] get user [%d]\'s relations of type %s, %s ~ %s, result: ", uid, user, type, from, to, (err ? err : JSON.stringify(uids)));

		if (err) {
			return res.status(500).send();
		}

		async.parallel({
			profiles: function(cb){
				require('./ProfileManager').getBrief(uids, cb); // runtime require, avoid circular dependency
			},
			subTo: function(cb){
				filterSubTo(uid, uids, cb);
			}
		}, function(err, results) {
			if (err) {
				return res.status(500).send();
			}
			results.success = true;
			res.json(results);
		});
	});
}

var filterSubTo = function(uid, users, callback) {
	Relation.find({'subject': uid, 'verb': relations.SUBSCRIBE_TO, 'object' : {'$in' : users}}, 'object').lean().exec(function(err, objects){
		if (err) {
			callback(err);
			return;
		}

		var uids = _.map(objects, function(object){
			return object.object;
		});

		callback(null, uids);
	});	
}

var getAllUidsSubscribeTo = function(uid, callback) {
	var from = 0;
	var to = config.subscribe_limit;

	_getUidsSubscribeTo(uid, from, to, callback);
}

var _getUidsSubscribeTo = function(uid, from, to, callback) {
	var skip = from;
	var limit = Math.min(to - from + 1, config.get_limit);

	Relation.find({'subject': uid, 'verb': relations.SUBSCRIBE_TO}, 'object').sort([['_id', -1]]).slice('_id', [skip, limit]).lean().exec(function(err, objects){
		if (err) {
			callback(err);
			return;
		}

		var uids = _.map(objects, function(object){
			return object.object;
		});

		callback(null, uids);
	});	
}

var _getUidsBeSubscribed = function(uid, from, to, callback) {
	var skip = from;
	var limit = Math.min(to - from + 1, config.get_limit);

	Relation.find({'verb': relations.SUBSCRIBE_TO, 'object': uid}, 'subject').sort([['_id', -1]]).slice('_id', [skip, limit]).lean().exec(function(err, subjects){
		if (err) {
			callback(err);
			return;
		}

		var uids = _.map(subjects, function(subject){
			return subject.subject;
		});

		callback(null, uids);
	});
}

// to solve curcular dependency, place exports here
module.exports = {
	update: update,
	get: get,
	filterSubTo: filterSubTo,
	getAllUidsSubscribeTo: getAllUidsSubscribeTo
}
