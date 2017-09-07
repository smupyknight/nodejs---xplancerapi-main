var logger = require('winston');
var config = require('config');
var _ = require('underscore');
//DB:
//sequences:{
//  name: string,
//  start: integer,
//  end: integer,
//  max: integer,
//  bulksize: integer,
//  ver: integer
//}
//
//In memory:
//sequences:{
//  name: {
//      id: integer,
//      max: integer
//  }
//}
//
var MAX_IDX = config.UidGenerator.max - config.UidGenerator.min;
var SEQUENCE_NAME = "sequences";
var MongoClient = require('mongodb').MongoClient;
var myDb;
var sequences = {};
var uidSlice;
var myMgdbUrl;

var init = function(mgdbUrl){
    myMgdbUrl = mgdbUrl;
};

var connect = function (callback) {
    if (myMgdbUrl === undefined || myMgdbUrl === null){
        callback(new Error('sequence db url not specified'));
        return;
    }

    if (myDb === undefined) {
        MongoClient.connect(myMgdbUrl, function (err, db) {
            if (err) {
                callback(err);
                return;
            }
            myDb = db;
            callback(null, db);
        });
    } else {
        callback(null, myDb);
    }
};

var findAndUpdateSequence = function(coll, name, callback){
    coll.findOne({name: name}, function(err, doc){
        if (err){
            callback(err);
            return;
        }

        if (!doc){
            callback(new Error('sequence:'+name+" not found"));
            return;
        }

        var start = doc.end +1;
        var max = doc.max? doc.max : MAX_IDX;
        var end = Math.min(start + doc.bulksize -1, max);
        if (start > max){
            callback(new Error('sequence value exceeds max:'+max));
            return;
        }

        // get uids
        myDb.collection("uid_sequence", function(err, uid_sequence_coll){
            if (err){
                callback(err);
                return;
            }

            uid_sequence_coll.find({_id: {'$gte': start, '$lte': end}}).toArray(function(err, uids){
                if (err){
                    callback(err);
                    return;
                }

                uidSlice = uids;

                logger.info("findAndUpdateSequence ", start, end, uidSlice.length);

                logger.debug('uidSlice', uidSlice);

                var ver = doc.ver;

                coll.update({name:name, ver: ver}, {"$set":{start: start, end: end, ver: ver + 1}}, function(err, writeResult){
                    if (err){
                        callback(err);
                        return;
                    }

                    var count = writeResult.result.nModified;
                    if (count !== 1){
                        logger.debug('ver changed, re-update sequence:', name, count);
                        findAndUpdateSequence(coll, name, callback);//TODO recursively update??
                    }else{
                        logger.debug('sequence:'+name+" updated, start:"+start+" max:"+end);

                        sequences[name] = {id:start, max:end};

                        callback(null);
                    }
                });
            });
        });
    });
};

//callback(err)
var updateSequence = function(name, callback){
    try{
        connect(function(err, db){
            if (err){
                callback(err);
                return;
            }

            db.collection(SEQUENCE_NAME, function(err, coll){
                if (err){
                    callback(err);
                    return;
                }

                findAndUpdateSequence(coll, name, callback);
            });
        });
    }catch (err){
        callback(err);
    }
};

//callback(err, id)
var getNextId = function(name, callback){
    var seq = sequences[name];

    if (seq === undefined || seq.id > seq.max){
        //if seq is not initialized or need to sync from mgdb
        sequences[name] = {wait:true};
        updateSequence(name, function(err){
            if (err){
                delete sequences[name];
                callback(err);
                return;
            }
            
            delete sequences[name].wait;
            getNextId(name, callback);//TODO recursively call, does this matter?
        });
        return;
    } else if (seq.wait){
        //wait for updated
        setTimeout(function(){
            getNextId(name, callback);
        }, 0);
    } else{
        var nextId = seq.id;
        seq.id += 1;

        //FIXME
        if (nextId > MAX_IDX){
            callback(new Error('sequence value exceeds:'+MAX_IDX));
        } else{
            var item = _.find(uidSlice, function(item){ return item._id === nextId});
            callback(null, item.value);
        }
    }
};

var Sequence = function(name){
    this.name = name;
};

Sequence.prototype.nextId = function(callback){
    getNextId(this.name, callback);
};

var getSequence = function(name){
    return new Sequence(name);
};

module.exports.getSequence = getSequence;
module.exports.init = init;
