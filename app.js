var express = require('express');
var http = require('http');
var path = require('path');
var config = require('config');
var redisUtil = require('./lib/utils/RedisClientUtil.js');
var idgenerator = require('./lib/model/idgenerator');
var mongoose = require('mongoose');
var TokenAuthManager = require('./lib/TokenAuthManager');

var logger = require('winston');
require('./lib/utils/LogUtil').init(config.Logger);

logger.info('env', process.env.NODE_ENV);

var roomController = require('./lib/RoomController');
redisUtil.createClient(config.Data, function(redisClient){
    roomController.init(redisClient);
});

var signalManager = require('./lib/SignalManager');
signalManager.init();

var onlineManager = require('./lib/OnlineManager');
onlineManager.init(config.Data);

var app = express();
app.disable('x-powered-by'); 
app.use(express.bodyParser({uploadDir:config.Upload.uploadDir, limit: 1024*1024*5}));
app.use(express.cookieParser());
app.use(express.session({secret: 'My_SEcret3134',  cookie:{maxAge:600000}}));
app.set('port', config.Base.http_port);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.logger('dev'));
app.use(express.favicon());
app.use(express.json());
app.use(express.urlencoded());
app.use(express.methodOverride());
app.use(app.router);
app.use(express.bodyParser());

// new version api
app.post('/room/create', TokenAuthManager.auth, roomController.create);
app.post('/room/join', TokenAuthManager.auth, roomController.join);
app.post('/room/leave', TokenAuthManager.auth, roomController.leave);
app.get('/room/get', roomController.get);
app.get('/room/getUsersIn', TokenAuthManager.auth, roomController.getUsersIn);


app.post(config.Online.notify_path, onlineManager.notifyOnlineStatus);


var dataDBUrl = config.Base.mgdb_url;
mongoose.connect(dataDBUrl);
if (! process.env.NODE_ENV || (process.env.NODE_ENV.indexOf('production') !== 0 )) {
    mongoose.set('debug', true);
}

var seqDBUrl = config.Base.mgdb_seq_url;
idgenerator.init(seqDBUrl);


// account related api
var accountManager = require('./lib/AccountManager');
accountManager.init();
app.post('/account/auth3party', accountManager.auth3party);

var TokenManager = require('./lib/TokenManager');
TokenManager.init(config.AuthConfig);

//relation related api
var relationManager = require('./lib/RelationManager');
app.post('/relation/update', TokenAuthManager.auth, relationManager.update);
app.get('/relation/get', TokenAuthManager.auth, relationManager.get);

// gift related api
var giftManager = require('./lib/GiftManager');
app.get('/gift/get', TokenAuthManager.auth, giftManager.get);
app.post('/gift/present', TokenAuthManager.auth, giftManager.present);

// credit related api
var creditManager = require('./lib/CreditManager');
app.get('/credit/get', TokenAuthManager.auth, creditManager.get);

// profile related api
var AWS = require('aws-sdk');
AWS.config.loadFromPath('./config/aws.json');

var photoManager = require('./lib/PhotoManager');
photoManager.init(config.Upload);

var profileManager = require('./lib/ProfileManager');
profileManager.init(config.ProfileManager, config.Upload);
app.post('/profile/update', TokenAuthManager.auth, profileManager.update);
app.post('/profile/get', TokenAuthManager.auth, profileManager.get);
app.get('/profile/search', TokenAuthManager.auth, profileManager.search);
app.post('/profile/uploadPhoto', TokenAuthManager.auth, profileManager.uploadPhoto);


http.createServer(app).listen(app.get('port'), function() {
    logger.info('Express server listening on port ' + app.get('port'));
});

