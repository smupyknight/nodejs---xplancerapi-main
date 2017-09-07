var logger = require('winston');
var Balance = require('./model/Models').model('Balance');
var Income = require('./model/Models').model('Income');

var get = function(req, res) {
	var uid = Number(req.query.uid);

	Balance.findOne({'_id': uid}, 'value unit').lean().exec(function(err, balance){
		if (err) {
			return res.status(500).send();
		}

		Income.findOne({'_id': uid}, 'value unit').lean().exec(function(err, income){
			if (err) {
				return res.status(500).send();
			}

			delete balance._id;
			delete income._id;

			logger.info('[%s] get credit, result: balance %s, income %s', uid, JSON.stringify(balance), JSON.stringify(income));

			res.json({
	            success: true,
	            balance: balance,
	            income: income
	        });
		});
	});
};

module.exports = {
	get: get
}