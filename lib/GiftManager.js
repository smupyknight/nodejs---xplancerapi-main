var logger = require('winston');
var giftType = require('./ConstDefined').GiftType;
var Gift = require('./model/Models').model('Gift');
var Presentation = require('./model/Models').model('Presentation');
var Balance = require('./model/Models').model('Balance');
var roomController = require('./RoomController');
var MongoUtil = require('./utils/MongoUtil');
var roomRole = require('./ConstDefined').RoomRole;
var ServerMsgType = require('./ConstDefined').ServerMsgType;
var _ = require('underscore');
var signalManager = require('./SignalManager');
var ObjectId = require('mongoose').Types.ObjectId;
var profileManager = require('./ProfileManager');

exports.get = function(req, res) {
	var uid = Number(req.query.uid);
	var type = Number(req.query.type);

	// check type
	if (type && !_.contains(_.values(giftType), type)) {
		return res.status(400).send("invalid type");
	}

	var query = (type ? {'available' : true, 'type' : type} : {'available' : true});

	Gift.find(query, '_id name type value render').lean().exec(function(err, gifts){
		logger.info('[%s] get gifts of type %d, results:', uid, type, (err ? err : JSON.stringify(_.map(gifts, function(gift){
			return gift.name;
		}))));

		if (err) {
			return res.status(500).send();
		}

		res.json({
            success: true,
            gifts: gifts.map(function(gift) {
            	gift.id = gift._id;
            	delete gift._id;
            	return gift;
            })
        });
	});
}

exports.present = function(req, res) {
	var uid = Number(req.body.uid);
	var to = Number(req.body.to);
	var gid = req.body.gid;
	var serial = req.body.serial;

	//check parameter
	if (!to || !serial || !gid || !ObjectId.isValid(gid)) {
		return res.status(400).send();
	}

	logger.info('[%d] present gift %s to [%d] with serial %d', uid, gid, to, serial);

	// get gift
	Gift.findOne({'_id': gid}, 'type value render available').lean().exec(function(err, gift){
		logger.debug('find gift', err, JSON.stringify(gift));

		if (err) {
			return res.status(500).send();
		}

		if (!gift) {
			return res.status(400).send();
		}

		if (!gift.available) {
			return res.json({success: false, error : 4, errMsg: 'gift not available'});
		}

		Balance.findOne({'_id': uid}, 'value').lean().exec(function(err, balance){
			if (err) {
				return res.status(500).send();
			}

			if (balance.value < 100 * gift.value.points) {
				return res.json({success: false, error : 1, errMsg: 'balance not enough'});
			}

			// check presentation duplication
			var date = new Date();
			date.setTime(date.getTime() - 36 * 3600 * 1000); // 36 hours ago
			var objectId = MongoUtil.getObjectIdWithTimestamp(date);
			Presentation.find({'from' : uid, 'to' : to, 'serial' : serial, '_id': { $gt: objectId}}, function(err, existPrst) {
				if (err) {
					return res.status(500).send();
				}

				if (existPrst.length > 0) {
					// this presentation request have been processed already
					logger.warn('[%d]\'s presentation with serial %d is already exist!', uid, serial);
					res.json({success: true});
			        return;
				}

				if (gift.type === giftType.IN_ROOM) {
					roomController.doGetUsersIn([to, uid], function(err, usersIn) {
						if (err) {
							return res.status(500).send();
						}

						if (usersIn.length < 2 || usersIn[0].rid !== usersIn[1].rid) {
							return res.json({success: false, error : 2, errMsg: 'not in same room'});
						} else if (usersIn[0].role !== roomRole.CREATOR) {
							return res.json({success: false, error : 3, errMsg: 'not creator'});
						} else {
							profileManager.getBrief([uid, to], function(err, profiles) {
								if (err) {
									return res.status(500).send();
								}

								var presentation = new Presentation();
								presentation.gid = gid;
								presentation.from = uid;
								presentation.to = to;
								presentation.serial = serial;

								presentation.save(function(err, prest){
									if (err) {
										return res.status(500).send();
									}

									res.json({success: true});

									// send channel msg to notify event
									var rid = usersIn[0].rid;
									signalManager.sendChannelMsg(rid, JSON.stringify({
										'type': ServerMsgType.PRESENTATION,
										'gift': {
											id: gid,
											render: gift.render,
											coins: gift.value.coins
										},
										'from': _.find(profiles, function(profile){ return profile.uid === uid}),
										'to': _.find(profiles, function(profile){ return profile.uid === to})
									}));
								});								
							});
						}
					});
				} else {
					return res.status(500).send('invalid gift type found');
				}
			});
		});
	});
}



