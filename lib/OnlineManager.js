var logger = require('winston');
var roomController = require('./RoomController');
var config = require('config');
var _ = require('underscore');
var redisUtil = require('./utils/RedisClientUtil.js');
var signalManager = require('./SignalManager');

var KEEP_ALIVE_PERIOD = 180;

var redis;

var PATTERN_KEY_ONLINE = new RegExp('^h_online_(\\d+)');

var init = function(redisConfig) {
	redisUtil.createClient(redisConfig, function(subRedis){
		subRedis.subscribe("__keyevent@9__:expired");
	    subRedis.on("message", function(channel, message){
	    	logger.debug('onMessage', channel, message);

	    	var segments = PATTERN_KEY_ONLINE.exec(message);

	    	var uid = segments[1];

	    	roomController.userDrop(uid, function(err, result){
	    		if (err) {
	    			logger.error('[%s] drop, but internal error', uid, err);
	    			return;
	    		}

	    		logger.info('[%s] drop, leave room:', uid, JSON.stringify(result));
	    	});
	    });
	});

	redisUtil.createClient(redisConfig, function(cmdRedis){
		redis = cmdRedis;
		signalManager.subscribeOnlineStatus();
	});
}

var notifyOnlineStatus = function(req, res) {
	logger.debug('notifyOnlineStatus from ', req.ip, JSON.stringify(req.body));

	var body = req.body;
	var sign = body.sign;
	delete body.sign;

	var keys = _.keys(body).sort();

	var stringToSign = '';
	for (var i = 0; i < keys.length; i++) {
		var key = keys[i];
		var value = body[key];
		stringToSign = stringToSign + key + value;
	}

	var signCalculated = crypto.createHmac('sha1', config.AuthConfig.sign_key)
						.update(stringToSign.toLowerCase(), 'utf8')
						.digest('hex');

	if (sign === signCalculated) {
		if (body._event === 'online') {
			var uid = Number(body.uid);
			var now = new Date().getTime();

			if (body.is_online) {
				userConnected(uid, now, function(err, result) {
					if (err) {
						logger.error('userConnected but internal err', err);
						return res.status(500).send();
					}
					res.json({success: true});
				});
			} else {
				userDisconnected(uid, now, function(err, result){
					if (err) {
						logger.error('userDisconnected but internal err', err);
						return res.status(500).send();
					}
					res.json({success: true});
				});
			}
		} else {	
			return res.status(400).send();
		}

		res.json({success: true});
	} else {
		logger.error('notify online status with incorrect sign');

		res.json({success: false, reason: 'invalid sign'});
	}
};

var userConnected = function(uid, connectedTime, callback) {
	logger.info('%s connected', uid);

	var key = getUserOnlineKey(uid);

	var multi = redis.multi();
	multi.hmset(key, 'connected', connectedTime);
	multi.hdel(key, 'disconnected');
	multi.persist(key);

	multi.exec(function(err, res){
		if (err) {
			callback(err);
			return;
		}

		callback(null, res);
	});
}

var userDisconnected = function(uid, disconnectedTime, callback) {
	logger.info('%s disconnected', uid);

	setTimeout(function() {	// delay handle disconneted event to avoid transient event
		var key = getUserOnlineKey(uid);

		redis.hget(key, 'connected', function(err, res){
			if (err) {
				callback(err);
				return;
			}

			if (res && Number(res) > disconnectedTime) {
				logger.info('reconnected already, drop disconneted event');
				callback(null);
			} else {
				var multi = redis.multi();
				multi.hmset(key, 'disconnected', disconnectedTime);
				multi.expire(key, KEEP_ALIVE_PERIOD);

				multi.exec(function(err, res){
					if (err) {
						callback(err);
						return;
					}
					callback(null, res);
				});
			}
		});
	}, 1000);
}


var getUserOnlineKey = function(uid) {
	return 'h_online_' + uid;
}

module.exports.init = init;
module.exports.notifyOnlineStatus = notifyOnlineStatus;
