var fs = require('fs');
var AWS = require('aws-sdk');
var async = require('async');
var _ = require('underscore');
var profileSource = require('./ConstDefined').ProfileSource;
var logger = require('winston');
var request = require('request');
var config = require('config');
var s3;
var bucket;

var init = function(config, callback){
    var options = {
        'apiVersion': config.S3.apiVersion,
        'endpoint': config.S3.endpoint
    };
    bucket = config.S3.bucket;
    s3 = new AWS.S3(options);

    if (callback) {
        callback();
    }
}

// 将第三方平台的图片下载下来，存储到 Vivid S3
var transferPhoto = function(uid, url, callback) {
    var dir = config.Upload.uploadDir;
    var downloadedFile = dir + '/' + uid + ".jpg"

    download(url, downloadedFile, function(err){
        if (err) {
            callback(err);
            return;
        }

        var timestamp = new Date().getTime();
        var storePath = uid +'/' + timestamp+'/';
        var destName = storePath+'0.jpg';

        uploadToS3(downloadedFile, destName, function(err, result){
            callback(err, storePath);
        });
    });
};


var uploadToS3 = function(path, destName, cb) {
    fs.readFile(path, function(err, data) {
        if (err) {
            logger.error('failed to load uploaded photo:' + path, err);
            cb(err);
            return;
        }

        var param = {
            Bucket: bucket,
            Key: destName,
            ContentType: 'image/jpeg',
            Body: data
        };

        s3.putObject(param, function(err, result) {
            if (err) {
                logger.error('failed to upload photo to S3', err);
                cb(err);
                return;
            }

            cb(null, result);
        });
    });
}

var download = function(url, file, callback){
  request.head(url, function(err, res, body){
    if (err) {
        callback(err);
        return;
    }

    logger.debug('content-type:', res.headers['content-type'], res.headers['content-length']);

    request(url).pipe(fs.createWriteStream(file)).on('close', callback);
  });
};

var cleanUp = function(reqFiles) {
    return function() {

        _.each(_.keys(reqFiles), function(key) {
            var fileName = reqFiles[key].path;
            fs.unlink(fileName, function(err) {
            });
        });
    };
};

module.exports.init = init;
module.exports.uploadToS3 = uploadToS3;
module.exports.cleanUp = cleanUp;
module.exports.transferPhoto = transferPhoto;
