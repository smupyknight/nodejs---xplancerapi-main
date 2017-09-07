var logger = require('winston');
var Account = require('./model/Models').model('Account');
var Profile = require('./model/Models').model('Profile');
var Balance = require('./model/Models').model('Balance');
var Income = require('./model/Models').model('Income');
var balanceUnit = require('./ConstDefined').BalanceUnit;
var incomeUnit = require('./ConstDefined').IncomeUnit;
var tokenManager = require('./TokenManager');
var Long = require('mongodb').Long;
var channels = require('./ConstDefined').Channels;
var _ = require('underscore');
var https = require('https');
var Client = require('node-rest-client').Client;
var config = require('config');
var querystring = require('querystring');

var client;

exports.init = function() {
	client = new Client();
}

exports.auth3party = function(req, res) {
	var channel = Number(req.body.channel);
	var channelUid = req.body.channelUid;
	var accessToken = req.body.accessToken;

	// check parameter
	if (channel === undefined || !_.contains(_.values(channels), channel)
		|| channelUid === undefined || channelUid.length === 0
		|| accessToken === undefined || accessToken.length === 0) {

		return res.status(400).send();
	}

	channelUid = channelUid.toString(); // channelUid is String in vivid ssytem

	validate3rdPartyAccount(channel, channelUid, accessToken, function(err, result) {
		logger.info('channel %s auth account [%s] with accessToken %s result:', channel, channelUid, accessToken, JSON.stringify(err ? err : result));

		if (err) {
			return res.status(500).send();
		}

		if (result.success) {
			// check account existence,
			Account.findOne({channel: channel, channelUid: channelUid}, function(err, account){
				if (err) {
		            logger.error('channel %s account [%s] auth3party error when find %s', channel, channelUid, err);
		            return res.status(500).send();
				}

				if (account) {
					var token = tokenManager.generateToken(account._id);

					res.json({
			            success: true,
			            uid: account._id,
			            token: token
			        });
				} else {
			        createAccount(channel, channelUid, function(err, acc){
			        	if (err) {
				            logger.error('channel %s account [%s] auth3party error when save %s', channel, channelUid, err);
				            return res.status(500).send();
			        	}

						var token = tokenManager.generateToken(acc._id);
						res.json({
				            success: true,
				            uid: acc._id,
				            token: token
				        });
			        });
				}
			})
		} else {
			res.json({
	            success: false,
	            error: result.error,
	            errMsg: result.errMsg
	        });
		}
	});
}

var validate3rdPartyAccount = function(channel, channelUid, accessToken, callback) {
	switch (channel) {
		case channels.WECHAT: {
			validateWeChatAccount(channel, channelUid, accessToken, callback);
			break;
		}
		case channels.QQ: {
			validateQQAccount(channel, channelUid, accessToken, callback);
			break;
		}
		case channels.WEIBO: {
			validateWeiboAccount(channel, channelUid, accessToken, callback);
			break;
		}
	}
}

var validateWeChatAccount = function(channel, channelUid, accessToken, callback) {
	var url = "https://api.weixin.qq.com/sns/auth?access_token=" + accessToken + "&openid=" + channelUid;

	client.get(url, function (resp, raw) {
		var data = JSON.parse(resp);
		if (data.errcode === 0) {
			callback(null, {
				success: true
			});
		} else {
			callback(null, {
				success: false,
	            error: data.errcode,
	            errMsg: data.errmsg
			});
		}
	}).on('error', function (err) {
        callback(err);
	});
}

var QQ_RESP_PATTERN = /^callback\( (.*) \);$/;

var validateQQAccount = function(channel, channelUid, accessToken, callback) {
	var url = "https://graph.qq.com/oauth2.0/me?access_token=" + accessToken;

	client.get(url, function (resp, raw) {
		if(Buffer.isBuffer(resp)){
		    resp = resp.toString('utf8');
		}

		var segments = QQ_RESP_PATTERN.exec(resp.trim()); // It's wired what qq returns Buffer like "callback({openid=.....})"

		if (segments.length > 1) {
			var data = JSON.parse(segments[1]);
		} else {
			callback(new Error('Illegal response'));
		}

		if (data.openid.toString() === channelUid) {
			callback(null, {
				success: true
			});
		} else {
			callback(null, {
				success: false,
	            error: data.error,
	            errMsg: data.error_description
			});
		}
	}).on('error', function (err) {
        callback(err);
	});
}

var validateWeiboAccount = function(channel, channelUid, accessToken, callback) {
	var url = "https://api.weibo.com/oauth2/get_token_info";

	var data = querystring.stringify({"access_token": accessToken});

	var args = {
	    data: data,
	    headers: {
	    	"Content-Type": "application/x-www-form-urlencoded",
	    	'Content-Length': Buffer.byteLength(data)
	    }
	};

	client.post(url, args, function (resp, raw) {
		var data = JSON.parse(resp);

		if (data.uid.toString() === channelUid) {
			callback(null, {
				success: true
			});
		} else {
			callback(null, {
				success: false,
	            error: data.code,
	            errMsg: data.msg
			});
		}
	}).on('error', function (err) {
        callback(err);
	});
}

var createAccount = function(channel, channelUid, callback) {
    var account = new Account();
    account.channel = channel;
    account.channelUid = channelUid;

    account.save(function(err, acc){
    	if (err) {
    		callback(err);
            return;
    	}

    	var profile = new Profile();
    	profile._id = acc._id;
    	profile.source = Long.fromNumber(0).getLowBitsUnsigned();;
    	profile.save(function(err, pfl){
	    	if (err) {
	    		callback(err);
	            return;
	    	}

	    	// init user balance
	    	var balance = new Balance();
	    	balance._id = acc._id;
	    	balance.value = Math.round(100 * config.Account.init_balance);
	    	balance.unit = balanceUnit.CENT_OF_POINT;
	    	balance.save(function(err, blc){
		    	if (err) {
		    		callback(err);
		            return;
		    	}

				// init user income
		    	var income = new Income();
		    	income._id = acc._id;
		    	income.value = Math.round(100 * config.Account.init_income);
		    	income.unit = incomeUnit.CENT_OF_COIN;
		    	income.save(function(err, icm){
			    	if (err) {
			    		callback(err);
			            return;
			    	}

			    	callback(null, acc);
		    	});
	    	});
    	});
    });
}





