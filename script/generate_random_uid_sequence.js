// HOW TO USE this script:
// execute cmd below:
// 		export NODE_ENV="$YOUR_ENVIREMENT"
//		export NODE_CONFIG_DIR='../config'
// 		node --max-old-space-size=4096 generate_random_uid_sequence.js

// run the script only once
// if need re-generate uid sequence, delete old sequence firstly.

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var config = require('config');
var async = require('async');

var min = config.UidGenerator.min;
var max = config.UidGenerator.max;
var length = max - min + 1;
// length = 99,999,999 - 10,000,000 + 1 = 90,000,000

var SLICE = 100000; // bulk insert amount

console.log('DEBUG %s: parameters, min %s, max %s, length %s', new Date().getTime(), min, max, length);

// 1. init sequence
var sequence = [];

for (var i = 0; i < length; i++) {
	sequence[i] = min + i;
}

// console.log('DEBUG %s: init sequence:', new Date().getTime(), JSON.stringify(sequence));
console.log('DEBUG %s: init sequence:', new Date().getTime());


// 2. random the sequence (shuffle)
for (var pos = length - 1; pos >= 0; pos--) {
	var maxx = sequence[pos];

	var randomIndex = Math.floor(Math.random() * (pos + 1));

	sequence[pos] = sequence[randomIndex];
	sequence[randomIndex] = maxx;
}

// console.log('DEBUG %s: random sequence: ', new Date().getTime(), JSON.stringify(sequence));
console.log('DEBUG %s: random sequence: ', new Date().getTime());


// 3. slice sequence to array
var sliceArray = [];
var sliceCount = Math.ceil(length / SLICE);
console.log('DEBUG %s: slice count: ', new Date().getTime());
for (var i = 0; i < sliceCount; i++) {
	sliceArray[i] = sequence.slice(i * SLICE, (i + 1) * SLICE);
	console.log('DEBUG %s: slice ', new Date().getTime(), i);
}

console.log('DEBUG %s: slice sequence: ', new Date().getTime());


// 4. save the random sequence to uid_sequence collection
// var db = config.Base.mgdb_url;
var db = config.get('Base.mgdb_seq_url');
mongoose.connect(db);

mongoose.connection.on("open",function(err) {
	console.log('INFO %s: start saving ', new Date().getTime());

	var UidSequence = new Schema({
		_id: Number,
		value: Number
	}, {collection:'uid_sequence'});
	UidSequence.index({value:1}, {unique:true});
	mongoose.model('UidSequence', UidSequence);
	var UidSequence = mongoose.model('UidSequence');

	async.eachOfSeries(sliceArray, function(slice, sliceIndex, callback){
		var bulk = UidSequence.collection.initializeOrderedBulkOp();

		for (var i = 0; i < slice.length; i++) {
			bulk.insert({_id: sliceIndex * SLICE + i, value: slice[i]});
		}

		bulk.execute(function(err, bulkResult){
			if (err) {
				console.log('ERROR %s: exec bulk error', new Date().getTime(), err);
				callback(err);
				return;
			}

			console.log('INFO %s: exec the %s th bulk.', new Date().getTime(), sliceIndex);

			callback();
		});
	}, function(err){
		if (err) {
			console.log('ERROR %s: save sequence stopped with error ', new Date().getTime(), err);
		} else {
			console.log('INFO %s: save sequence finished.', new Date().getTime());
		}
	});
});







