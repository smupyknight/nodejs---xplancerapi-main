var Redis = require('redis');
var logger = require('winston');

//callback(err, redis)
var createClient = function(config, callback){
    var host = config.redis_host;
    var port = config.redis_port;
    var db = config.db;
    var redisClient = Redis.createClient(port, host);

    redisClient.on('connect', function(){
        logger.info('conn success to redis [%s:%s]', host, port, db);
    });
    redisClient.on('error', function(err){
        logger.error('conn error to redis [%s:%s]', host, port, JSON.stringify(err));
    });

    if (db){
        redisClient.select(db, function(err){
            logger.debug('createClient ', host, port, db);
            callback(redisClient)
        });
    } else {
        callback(redisClient);
    }

};

module.exports.createClient = createClient;