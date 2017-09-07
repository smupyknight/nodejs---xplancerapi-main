var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var Mixed = Schema.Types.Mixed;
var logger = require('winston');
var idgenerator = require('./idgenerator');
var _ = require('underscore');

/**
 * Data models used in the backend
 * Account - for authenticated
 */

/**
 * Helper method to add a middleware to scheme, to generate id before an object is saved.
 */
var generateRandomNumberId = function(schema, seqName) {
    logger.debug("enter generateRandomNumberId");

    var seq = idgenerator.getSequence(seqName);

    schema.pre('save', function(next) {
        var that = this;
        if (this._id === undefined || this._id === null || this._id <= 0) {
            seq.nextId(function(err, id) {
                if (err) {
                    next(err);
                }

                that._id = id;

                next();
            });
        } else{
            next();
        }
    });
};

var incrementVersionAfterUpdate = function(schema) {
    schema.post('update', function(result) {
        result = result.result; // seems mongoose result an object in which real result is an property
        if (result.nModified > 0) {
            this.findOneAndUpdate({}, {
                $inc: { __v: 1 }
            }).exec();
        }
    });
}

// if 3party: _id, channel, channelUid; 
// if use phone: _id, channel, phone;
var account = new Schema({
    _id: Number,
    channel: Number,
    channelUid: String,
    phone: String
}, {collection: 'account'});

generateRandomNumberId(account, 'account');

var profile = new Schema({
    _id: Number,
    nick: String,
    sex: Number,
    signature: String,
    photoPath: String,
    source: Number,
    subTo: Number, // 关注了多少人
    subed: Number // 被多少人关注
    // __v
}, {collection: 'profile'});

incrementVersionAfterUpdate(profile);

profile.index({nick:1}, {sparse:true});

var balance = new Schema({
    _id: Number,
    value: Number,
    unit: Number,
}, {collection:'balance'});

var income = new Schema({
    _id: Number,
    value: Number,
    unit: Number,
}, {collection:'income'});

var relation = new Schema({
    subject: Number,
    verb: Number, // 1: subscribe
    object: Number
},{collection: 'relation'});
relation.index({subject: 1});
relation.index({object: 1});

var gift = new Schema({
    type: Number,
    name: String,
    render: Number,
    value: Mixed,
    available: Boolean
}, {collection: 'gift'});

var presentation = new Schema({
    gid: String,
    from: Number,
    to: Number,
    serial: Number
}, {collection: 'presentation'});


mongoose.model('Account', account);
mongoose.model('Profile', profile);
mongoose.model('Balance', balance);
mongoose.model('Income', income);
mongoose.model('Relation', relation);
mongoose.model('Gift', gift);
mongoose.model('Presentation', presentation);

module.exports = mongoose;


