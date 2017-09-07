var Long = require('mongodb').Long;

module.exports.Channels = {
    "WECHAT" : 1,
    "QQ": 2,
    "WEIBO": 3
};

// relation type
module.exports.Relations = {
	"SUBSCRIBE_TO" : 1 << 0,
	"BE_SUBSCRIBED" : 1 << 1
};

// update relation action type
// always keep UNSUBSCRIBE < SUBSCRIBE for easy sorting
module.exports.RelationActions = {
	"UNSUBSCRIBE" : 1,
	"SUBSCRIBE" : 2
};

module.exports.RoomFilter = {
	"ALL" : 1,
	"HOT" : 2,
	"SUBSCRIBED" : 3,
	"SPECIFIC": 4
};

module.exports.RoomRole = {
	"CREATOR" : 1,
	"AUDIENCE" : 2
};

module.exports.GiftType = {
	"IN_ROOM" : 1
};

module.exports.FakedUid = {
	'VIVID_SERVER' : 1000000
};

module.exports.ServerMsgType = {
	'PRESENTATION': 1,
	'CHANNEL_USER_JOINED': 2
};

module.exports.BalanceUnit = {
	'CENT_OF_POINT': 1
};

module.exports.IncomeUnit = {
	'CENT_OF_COIN': 1
};

module.exports.ProfileSource = {
	'THIRD_PARTY' : 1,
	'VIVID' : 2
}

module.exports.Sex = {
	'MALE' : 1,
	'FEMAIL' : 2
}

var BIT_BASE = Long.fromNumber(1).getLowBitsUnsigned(); // 1, int32

module.exports.ProfileBit = {
	"NICK": BIT_BASE << 0,
	"SEX": BIT_BASE << 1,
	"SIGNATURE": BIT_BASE << 2,
	"PHOTO_PATH": BIT_BASE << 3
}

