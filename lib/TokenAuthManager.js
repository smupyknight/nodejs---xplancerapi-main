//Auth manager required by express to verify token
var logger = require('winston');

var tokenManager = require('./TokenManager');
var Account = require('./model/Models').model('Account');

exports.auth = function(req, res, next) {
	var uid = req.body.uid || req.query.uid;
	var token = req.header('token') || req.body.token;

	if (!uid || !token) {
		res.status(400).send('Invalid identity');
		return;
	}

	if (tokenManager.auth(uid, token)) {
		next();
		return;
	} else {
		res.status(401).send('Invalid user/token');
		return;
	}
};



