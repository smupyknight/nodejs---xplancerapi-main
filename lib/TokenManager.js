// 第三方厂商的用户在第三方厂商登录成功后， 厂商给用户颁发Token。
// token = <type>:<vendorkey>:<expiredTime>:<sign>, 4个字段通过分号拼装成的字符串
// type = 1. 表示目前使用MD5做签名
// sign = MD5(uid+vendorkey+signkey+expiredTime)
// expiredTime 为该token 的失效时间，为Unix timestamp

var logger = require('winston');
var config = require('config');
var crypto = require('crypto');

var TOKEN_TYPE = 1;

var vendorKey;
var signKey;
var expiredSec;
exports.init = function(config){
    vendorKey = config.vendor_key;
    signKey = config.sign_key;
    expiredSec = config.expired_sec || 2592000;
}


var generateSign = function(uid, expired){
    var toSign = uid+vendorKey+signKey+expired;
    var md5 = crypto.createHash('md5');
    md5.update(toSign, 'utf-8');
    var sign = md5.digest('hex');
    return sign;
}

exports.generateToken = function(uid){
    var now = Math.round(new Date().getTime() / 1000);
    var expired = now + expiredSec;

    var sign = generateSign(uid, expired);

    var token = [TOKEN_TYPE, vendorKey, expired, sign].join(':');
    return token;
}


exports.auth = auth = function(uid, token){
    var params = token.split(':');

    if (params.length != 4){
        return false;
    }

    if (params[0] != TOKEN_TYPE){
        return false;
    }

    var vkey = params[1];
    var expiredTime = Number(params[2]);
    var sign = params[3];

    if (vkey != vendorKey){
        return false;
    }

    var now = new Date().getTime() / 1000;
    if (now >= expiredTime){
        return false;
    }

    return sign == generateSign(uid, expiredTime);
}


exports.authGenerateToken = function(uid, token){
    if (!auth(uid, token)){
        return null;
    }

    return generateToken(uid);
}
