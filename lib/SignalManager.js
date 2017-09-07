var logger = require('winston');
var config = require('config');
var _ = require('underscore');
var crypto = require('crypto');
var Client = require('node-rest-client').Client;
var PeriodicUniqIdGenerator = require('./utils/PeriodicUniqIdGenerator');
var FakedUid = require('./ConstDefined').FakedUid;


//Agora的Server, 支持查询和订阅
var AGORA_SERVER_URL;

var PING_CYCLE = 24 * 3600 * 1000;

var client;
var midGenerator;

var init = function() {
	client = new Client();
	midGenerator = new PeriodicUniqIdGenerator('messageId');
	AGORA_SERVER_URL = config.SignalManager.signal_server;

	startServer();

	setInterval(ping, PING_CYCLE);
}

var startServer = function() {
	var appendData = {
	    'account': FakedUid.VIVID_SERVER.toString(),
	    'url': 'http://my.server.vendorX.com/agora/events/'
	};

	signal('start_server', appendData, function(err, resp) {
		// do nothing
	});
}

var ping = function() {
	var appendData = {
	    'account': FakedUid.VIVID_SERVER.toString(),
	    'kargs': JSON.stringify({})
	};

	signal('server_ping', appendData, function(err, resp) {
		// do nothing
	});
}

var subscribeOnlineStatus = function() {
	var appendData = {
	    'url': 'http://' + config.Base.http_host + config.Online.notify_path
	};

	signal('subscribe_online', appendData, function(err, resp) {
		// do nothing
	});
};

var joinChannel = function(rid) {
	var appendData = {
	    'account': FakedUid.VIVID_SERVER.toString(),
	    'kargs': JSON.stringify({
	    	'name': rid
	    })
	};

	signal('channel_join', appendData, function(err, resp){
		// do nothing
	});
};

var leaveChannel = function(rid) {
	var appendData = {
	    'account': FakedUid.VIVID_SERVER.toString(),
	    'kargs': JSON.stringify({
	    	'name': rid
	    })
	};

	signal('channel_leave', appendData, function(err, resp){
		// do nothing
	});
}

var sendChannelMsg = function(rid, msg) {
	logger.debug('sendChannelMsg', rid, msg);

	var appendData = {
	    'account': FakedUid.VIVID_SERVER.toString(),
	    'kargs': JSON.stringify({
	    	'name': rid,
	    	'msg': msg
	    })
	};

	signal('channel_sendmsg', appendData, function(err, resp){
		// do nothing
	});
};

var signal = function(func, appendData, callback) {
    var now = new Date().getTime();

	var data = {
		'_vendorkey': config.AuthConfig.vendor_key,
	    '_callid'   : midGenerator.nextId(),
	    '_timestamp': now,
	    '_function' : func
	};

	_.extend(data, appendData);

	var keys = _.keys(data).sort();

	var stringToSign = '';
	for (var i = 0; i < keys.length; i++) {
		var key = keys[i];
		var value = data[key];
		stringToSign = stringToSign + key + value;
	}

	var sign = crypto.createHmac('sha1', config.AuthConfig.sign_key)
						.update(stringToSign.toLowerCase())
						.digest('hex');
	data._sign = sign;

	var args = {
	    data: data,
	    headers: { "Content-Type": "application/json" }
	};

	client.post(AGORA_SERVER_URL, args, function(resp, raw){
		logger.info('ToSignal %s: %s resp: %s', 
			data._function, (appendData.kargs ? 'kargs:' + appendData.kargs + ',' : ''), JSON.stringify(resp));
		callback(null, resp);
	}).on('error', function (err) {
		logger.error('ToSignal: %s, error %s', JSON.stringify(data), err);
		callback(err, resp);
	});
};


module.exports = {
	init: init,
	joinChannel: joinChannel,
	leaveChannel: leaveChannel,
	sendChannelMsg: sendChannelMsg,
	subscribeOnlineStatus: subscribeOnlineStatus
};
