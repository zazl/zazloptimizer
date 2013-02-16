/*
    Copyright (c) 2004-2013, The Dojo Foundation All Rights Reserved.
    Available via Academic Free License >= 2.1 OR the modified BSD license.
    see: http://dojotoolkit.org/license for details
*/
var fs = require('fs');
var path = require('path');
var util = require('./util');

var providerPaths = [];
var cache = {};

function getTimestamp(filePath, root, cb) {
	filePath = path.join(root, String(filePath));
    fs.exists(filePath, function(exists) {
        if (exists === true) {
			fs.stat(filePath, function(err, stats) {
				if (err) { throw err; }
				cb(stats.mtime.getTime());	
			});
		} else {
			cb(-1);
		}
    });
}

function findPath(filePath, cb) {
    var p;
    var result;
    
    var callback = util.createCallback(providerPaths.length, function() {
		cb(result);
    });
    providerPaths.forEach(function(pathValue, index) {
		p = path.join(pathValue, String(filePath));
		fs.exists(p, function(exists) {
			if (exists === true) {
				result = pathValue; 
			}
			callback();
		});
    });
}

exports.addProvider = function(providerPath) {
	providerPaths.push(providerPath);
};

exports.addProvider(path.dirname(module.filename));

exports.getTimestamp = function(filePath, cb) {
    findPath(filePath, function(root) {
		if (root) {
			getTimestamp(filePath, root, function(ts) {
				cb(ts);
			});
		} else {
			cb(-1);
		}
    });
};

function readTextFile(filePath, root, cb) {
	filePath = path.join(root, String(filePath));
    fs.exists(filePath, function(exists) {
		if (exists === true) {
			fs.readFile(filePath, 'utf8', function(err, contents) {
				if (err) {throw err; }
				cb(contents);
			});
		} else {
			cb();
		}
    });
}

exports.readText = function(filePath, cb) {
    findPath(filePath, function(root) {
		if (root) {
			readTextFile(filePath, root, function(contents) {
				if (contents) {
					getTimestamp(filePath, root, function(ts) {
						cache[filePath] = {contents: contents, ts: ts, root: root};
						cb(contents);					
					});
				} else {
					cb();
				}
			});
		} else {
			cb();
		}
    });
};
