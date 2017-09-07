var logger = require('winston');
/**
* 31 位的id, 生成在36小时内， 不重复的id。(31是为了保证不出现负数， 因为老的app肯能用uint 32)
* 其中：
* 0-9 共10bit: 本地秒内自增id, 范围 0 - 1023
* 10 - 13 共4bit： 节点id, 范围 0 - 15, 表示16台生成ID的服务器
* 14 - 30 共17bit: 秒的到EPOCH的便宜的模， 最大131072秒，相当于36 小时
* id = s << 14 + n <<10 + idx
*/

var MAX_TIME = Math.pow(2, 17) - 1;
var MAX_NODE_IDX = Math.pow(2, 4) - 1;
var MAX_LOCAL_IDX = Math.pow(2, 10) - 1;

var localIdx = new Date().getMilliseconds();  //如果进程在一秒钟内多次重启 也不会出现在秒内的重复本地id
var nodeId = 1;
var lastSec;

var PeriodicUniqIdGenerator = function(daemon) {
    this.daemon = daemon;
}

PeriodicUniqIdGenerator.prototype.initIDCNodeId = function(idcId, theNodeId){
    idcId = idcId % 2;
    theNodeId = theNodeId % 8;

    nodeId = idcId << 3 + theNodeId;

    logger.info('PeriodicUniqIdGenerator initialize with nodeId:'+nodeId);
}

PeriodicUniqIdGenerator.prototype.init = function(theNodeId) {
    if (theNodeId < MAX_NODE_IDX) {
        nodeId = theNodeId;
    } else {
        throw new Error('nodeId creater than ' + MAX_NODE_IDX);
    }
};


PeriodicUniqIdGenerator.prototype.nextId = function() {
    var nowSecs = Math.round(new Date().getTime() / 1000);

    var timePart = nowSecs % MAX_TIME;

    //如果秒差发生了变化， localIdx也要归零
    localIdx ++;
    if (localIdx > MAX_LOCAL_IDX || (lastSec && (lastSec !== nowSecs))){
        localIdx = 0;
    }

    //javascript bitwise support max 32bit
    // var result = (timePart << 25) | (nodeId << 17) | localIdx;
    var result = (timePart <<14) + (nodeId << 10) + localIdx; //2 ** 25

    lastSec = nowSecs;

    return result;
};

module.exports = PeriodicUniqIdGenerator;
