/*
    Copyright (c) 2004-2013, The Dojo Foundation All Rights Reserved.
    Available via Academic Free License >= 2.1 OR the modified BSD license.
    see: http://dojotoolkit.org/license for details
*/
var crypto = require('crypto');
var path = require('path');
var resourceloader = require('./resourceloader');
var util = require("./util");
var fs = require('fs');

var cache = {};

var analyzer = require('./amdanalyzer');

function loadAnalysis(key, cb) {
	function readAnalysisFile() {
		fs.readFile("./tmp/"+key+".json", 'utf8', function(err, contents) {
			if (contents) {
				console.log("Read analysis for ["+key+"]");
				var analysisData = JSON.parse(contents);
				cb(analysisData);
			} else {
				cb();
			}
		});
	}
	fs.exists("./tmp", function (exists) {
		if (!exists) {
			fs.mkdir("./tmp", 0777, function(){
				readAnalysisFile();
			});
		} else {
			readAnalysisFile();
		}
	});
}

function saveAnalysis(key, analysisData, cb) {
	function writeAnalysisFile() {
		var data = JSON.stringify(analysisData, null, "\t");
		fs.writeFile("./tmp/"+key+".json", data, 'utf8', function(err) {
			if (err) {
				throw err;
			}
			cb();
		});
	}
	fs.exists("./tmp", function (exists) {
		if (!exists) {
			fs.mkdir("./tmp", 0777, function(){
				writeAnalysisFile();
			});
		} else {
			writeAnalysisFile();
		}
	});
}

function toHash(value) {
	var md5Hash = crypto.createHash("md5");
	md5Hash.update(value);
	return md5Hash.digest('hex');
}

function getExcludes(excludeKeys) {
	var excludes = [];
	var seen = {};
	var analysisData;
	
	for (var i = 0; i < excludeKeys.length; i++) {
		analysisData = cache[excludeKeys[i]].analysisData;
		for (var j = 0; j < analysisData.dependencyList.length; j++) {
			var dep = analysisData.dependencyList[j];
			if (!seen[dep]) {
				excludes.push(dep);
				seen[dep] = true;
			}
		}
	}
	return excludes;
}

function createChecksum(analysisData, cb) {
	var js = "";
	
	var callback = util.createCallback(analysisData.dependencyList.length, function() {
		cb(toHash(js));
	});
	
	for (var i = 0; i < analysisData.dependencyList.length; i++) {
		resourceloader.readText(path.normalize(analysisData.dependencyList[i]+".js"), function(text) {
			js += text;
			callback();
		});
	}
}

function isStale(cacheEntry, cb) {
	var stale = false;
	var analysisData = cacheEntry.analysisData;
	
	var callback = util.createCallback(analysisData.dependencyList.length, function() {
		cb(stale);
	});
	
	analysisData.dependencyList.forEach(function(dependency) {
        var dependencyPath = path.normalize(dependency)+".js";
		resourceloader.getTimestamp(dependencyPath, function(ts) {
	        if (ts !== -1 && ts !== cacheEntry.timestamps[dependency]) {
				stale = true;
			}
			callback();
		});
	});	
}

function getTimestamps(dependencyList, cb) {
	var timestamps = {};

	var callback = util.createCallback(dependencyList.length, function() {
		cb(timestamps);
	});
	
	dependencyList.forEach(function(dependency) {
        var dependencyPath = path.normalize(dependency)+".js";
        resourceloader.getTimestamp(dependencyPath, function(timestamp) {
			timestamps[dependency] = timestamp;
			callback();
        });
	});
}

var getKey = function(modules, excludesKeys, config) {
	var excludes = getExcludes(excludesKeys);
	var key = "keyValues:";
	var i;
	
	for (i = 0; i < modules.length; i++) {
		key += modules[i];
	}
	
	key += "excludeValue:";
	
	for (i = 0; i < excludes.length; i++) {
		key += excludes[i];
	}
	
	if (config) {
		key += "configValue:";
		key += JSON.stringify(config);
	}
	return toHash(key);
};

exports.getKey = getKey;

exports.getAnalysisData = function(modules, excludes, config, cb) {
	var key = getKey(modules, excludes, config);
	var cacheEntry = cache[key];
	
	function doAnalysis() {
		analyzer.createAnalyzer(config).getAnalysisData(modules, getExcludes(excludes), function(analysisData) {
			analysisData.key = key;
			createChecksum(analysisData, function(checksum) {
				analysisData.checksum = checksum;
				getTimestamps(analysisData.dependencyList, function(timestamps) {
					cacheEntry.analysisData = analysisData;
					cacheEntry.timestamps = timestamps;
					cacheEntry.state = 1;
					saveAnalysis(key, cacheEntry, function() {
						console.log("Save analysis for ["+key+"]");
					});
					cb(cacheEntry.analysisData);
				});
			});
		});
	}
	
	if (cacheEntry) {
		if (cacheEntry.state === 0) {
			var isComplete = function() {
				if (cacheEntry.state === 1) {
					cb(cacheEntry.analysisData);
				} else {
					process.nextTick(isComplete);
				}
			}
			process.nextTick(isComplete);
		} else {
			isStale(cacheEntry, function(stale) {
				if (stale === true) {
					cacheEntry.state = 0;
					doAnalysis();
				} else {
					cb(cacheEntry.analysisData);
				}
			});
		}
	} else {
		loadAnalysis(key, function(data) {
			if (data) {
				cacheEntry = data;
				cache[key] = cacheEntry;
				isStale(cacheEntry, function(stale) {
					if (stale === true) {
						cacheEntry.state = 0;
						doAnalysis();
					} else {
						cb(cacheEntry.analysisData);
					}
				});
			} else {
				cacheEntry = {state: 0};
				cache[key] = cacheEntry;
				doAnalysis();
			}
		});
	}
};

exports.getAnalysisDataFromKey = function(key) {
	var cacheEntry = cache[key];
	return cacheEntry ? cacheEntry.analysisData : undefined;
};

exports.analysisInProcess = function(key) {
	var cacheEntry = cache[key];
	var state = cacheEntry ? cacheEntry.state : -1;
	if (state === 0) {
		return true;
	} else {
		return false;
	}
};