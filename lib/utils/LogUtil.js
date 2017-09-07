//根据配置初始化winston

var winston = require('winston');
var _ = require('underscore');

/**
 * config: {
 *   [
 *   name: FQN,
 *   options:{
 *       json: boolean,
 *       level: string,
 *       filename: string //default 'log'
 *   }
 *   ]
 * }
 *
 */
module.exports.init = function(configs) {
    winston.remove(winston.transports.Console);

    _.each(configs, function(config) {
        if (config.name && config.name.indexOf('winston.transports') === 0 && config.options) {
            var transport = eval(config.name); //TODO any good way to convert string to object?
            config.options.timestamp = true;
            winston.add(transport, config.options);
        }
    });
};