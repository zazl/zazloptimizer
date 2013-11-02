/*
    Copyright (c) 2004-2013, The Dojo Foundation All Rights Reserved.
    Available via Academic Free License >= 2.1 OR the modified BSD license.
    see: http://dojotoolkit.org/license for details
*/
var url = require('url');
var path = require('path');
var qs = require('querystring');
var resourceloader = require('./resourceloader');
var zlib = require('zlib');
var analyzer = require('./analyzer');
var UglifyJS = require("uglify-js");
var util = require("./util");
var fs = require("fs");

var compressedCache = {};

function getBestFitLocale(localeHeader) {
    var localeRegex = /([a-z]{1,8}(-[a-z]{1,8})?)\s*(;\s*q\s*=\s*(1|0\.[0-9]+))?/i;
    var locales = localeHeader.split(',');
    var bestFitQfactor = 0;
    var bestFitLocale = "";
    for (var i = 0; i < locales.length; i++) {
        var matches = localeRegex.exec(locales[i]);
        var qfactor = parseFloat(matches[4]) || 1.0;
        if (qfactor > bestFitQfactor) {
			bestFitQfactor = qfactor;
			bestFitLocale = matches[1];
        }
    }
	return bestFitLocale;
}

var HttpResponseWriter = function(request, response){
	this.request = request;
	this.response = response;
	this.usegzip = false;
	var encoding = request.headers["accept-encoding"];
	if (encoding && encoding.match(/\bgzip\b/)) {
		this.usegzip = true;
		this.buffer = "";
		this.response.writeHead(200, { 'content-encoding': 'gzip' });
	}
};
		
HttpResponseWriter.prototype = {
	write: function(content) {
		if (this.usegzip) {
			this.buffer += content;
		} else {
			this.response.write(content);
		}
	},
	end: function() {
		if (this.usegzip) {
			var scope = this;
			zlib.gzip(this.buffer, function(error, buffer){
				if (!error) {
					scope.response.write(buffer);
				} else {
					console.log("Failed to gzip :"+error);
				}
				scope.response.end();
			});
		} else {
			this.response.end();
		}
	}
};

StringWriter = function(cb) {
	this.cb = cb;
	this.output = '';
};

StringWriter.prototype = {
	write: function(content) {
		this.output += content;
	},
	end: function() {
		this.cb(this.output);
	}
};

function lookForMissingName(uri, missingNamesList) {
    var missingNameIndex = -1;
    for (var i = 0; i < missingNamesList.length; i++) {
        if (uri === missingNamesList[i].uri) {
            missingNameIndex = missingNamesList[i].nameIndex;
            break;
        }
    }
    return missingNameIndex;
}

function getMissingNameId(uri, missingNamesList) {
	var id = null;
    for (var i = 0; i < missingNamesList.length; i++) {
        if (uri === missingNamesList[i].uri) {
            id = missingNamesList[i].id;
            break;
        }
    }
	return id;
}

function writeLocalization(responseWriter, content, moduleName) {
	var str = content.substring(0, content.indexOf('(')+1);
	str += "'";
	str += moduleName;
	str += "',";
	str += content.substring(content.indexOf('(')+1);
	str += "\n";
	responseWriter.write(str);
}

function writeLocalizations(responseWriter, localizations, locale) {
	var intermediateLocale = null;
	if (locale.indexOf('-') !== -1) {
		intermediateLocale = locale.split('-')[0];
	}
	localizations.forEach(function(localization) {
		var rootModule = path.normalize(localization.bundlepackage).replace(/\\/g, "/");
		var fullModule = path.normalize(localization.modpath+'/'+locale+'/'+localization.bundlename).replace(/\\/g, "/");
		var intermediateModule;
		if (intermediateLocale !== null) {
			intermediateModule = path.normalize(localization.modpath+'/'+intermediateLocale+'/'+localization.bundlename).replace(/\\/g, "/");
		}
		resourceloader.readText(rootModule+".js", function(root){
			if (root) {
				writeLocalization(responseWriter, root, rootModule);
			}
		});
		if (intermediateModule !== null) {
			resourceloader.readText(intermediateModule+".js", function(lang) {
				if (lang) {
					writeLocalization(responseWriter, lang, intermediateModule);
				}
			});
		}
		resourceloader.readText(fullModule+".js", function(langCountry) {
			if (langCountry) {
				writeLocalization(responseWriter, langCountry, fullModule);
			}
		});
	});
}

function compress(content) {
	var result = UglifyJS.minify(content, {fromString: true});
	return result.code;
}

function writeResponse(writeBootstrap, analysisData, excludes, responseWriter, config, compressContent, localeStr, writeAnalysisKey) {
	var i;
	if (writeBootstrap && writeBootstrap === true) {
		var bootstrapModulePaths = config.bootstrapModules;
		for (i = 0; i < bootstrapModulePaths.length; i++) {
			var bootstrapModulePath = path.normalize(bootstrapModulePaths[i]);
	        if (compressContent) {
				resourceloader.getTimestamp(bootstrapModulePath, function(ts) {
					var cacheEntry = compressedCache[bootstrapModulePath];
					if (cacheEntry && cacheEntry.ts === ts) {
						responseWriter.write(cacheEntry.content);
					} else {
						resourceloader.readText(bootstrapModulePath, function(text) {
							var compressed = compress(text);
							responseWriter.write(compressed);
							compressedCache[bootstrapModulePath] = {content: compressed, ts: ts};
						});
					}
				});
	        } else {
				resourceloader.readText(bootstrapModulePath, function(text) {
					responseWriter.write(text);
				});
	        }
		}
	}
	
	if (writeAnalysisKey) {
		responseWriter.write("zazl.addAnalysisKey('"+analysisData.key+"');\n");
	}
	
	var exludeAnalysisData;
	var pluginRefs;
	var pluginRefList;
	var pluginRef;
	var seen = {};
	var localizations = [];
	
	var i18nPluginId = config.amdconfig["i18nPluginId"];
	
	if (i18nPluginId) {
		for (i = 0; i < excludes.length; i++) {
			exludeAnalysisData = analyzer.getAnalysisDataFromKey(excludes[i]);
			pluginRefs = exludeAnalysisData.pluginRefs;
			if (pluginRefs && pluginRefs[i18nPluginId]) {
				pluginRefList = pluginRefs[i18nPluginId];
				for (var j = 0; j < pluginRefList.length; j++) {
					seen[pluginRefList[j].normalizedName] = true;
				}
			}
		}
	}
	
	for (pluginRef in analysisData.pluginRefs) {
		pluginRefList = analysisData.pluginRefs[pluginRef];
		for (i = 0; i < pluginRefList.length; i++) {
			if (pluginRefList[i].value) {
				responseWriter.write(pluginRefList[i].value);
			}
		}
		if (i18nPluginId && i18nPluginId === pluginRef) {
			var bundlePackage;
			var moduleUrl;
			var modulePath;
			var bundleName;
			var localization;
			
			for (i = 0; i < pluginRefList.length; i++) {
				bundlePackage = pluginRefList[i].normalizedName;
				moduleUrl = pluginRefList[i].moduleUrl;
				if (!seen[bundlePackage]) {
					seen[bundlePackage] = true;
					modulePath = bundlePackage.substring(0, bundlePackage.lastIndexOf('/'));
					moduleUrl = moduleUrl.substring(0, moduleUrl.lastIndexOf('/'));
					bundleName = bundlePackage.substring(bundlePackage.lastIndexOf('/')+1);
					localization = {
						bundlepackage: bundlePackage, 
						modpath: modulePath, 
						bundlename: bundleName, 
						moduleurl: moduleUrl 
					};
					localizations.push(localization);
				}
			}
		}
	}
	
	if (localizations.length > 0) {
		writeLocalizations(responseWriter, localizations, getBestFitLocale(localeStr));
	}

	var dependencyList = analysisData.dependencyList.slice();
	var callback = function() {
		var dependency = dependencyList.shift();
		if (!dependency) {
			responseWriter.end();
			return;
		}
		var uri = path.normalize(dependency);
        var dependencyPath = uri+".js";
        resourceloader.getTimestamp(dependencyPath, function(ts) {
			var keepgoing = true;
			if (compressContent) {
				var cacheEntry = compressedCache[dependency];
				if (cacheEntry && cacheEntry.ts === ts) {
					responseWriter.write(cacheEntry.content);
					callback();
					keepgoing = false;
				}
			}
			if (keepgoing === true) {
				resourceloader.readText(dependencyPath, function(content) {
					var missingNameIndex = lookForMissingName(dependency, analysisData.missingNamesList);
		
					if (missingNameIndex !== -1) {
						var modifiedContent = content.substring(0, missingNameIndex);
						modifiedContent += "'"+getMissingNameId(dependency, analysisData.missingNamesList)+"', ";
						modifiedContent += content.substring(missingNameIndex);
						content = modifiedContent;
					}
					if (analysisData.shims && analysisData.shims[dependency]) {
						content += analysisData.shims[dependency];
					}
					if (compressContent) {
						var compressed = compress(content);
						responseWriter.write(compressed);
						compressedCache[dependency] = {content: compressed, ts: ts};
					} else {
						responseWriter.write(content);
					}
					callback();
				});
			}
        });
	};
	callback();
}

function handle(request, response, config, compress) {
	var requestURL = url.parse(request.url);
	var params = qs.parse(requestURL.query);
	if (params.modules !== undefined) {
		var modules = params.modules.split(',');
		var p;
		var excludes = [];
		if (params.exclude) {
			excludes = params.exclude.split(',');
		}
		var fullConfig = {};
		for (p in config.amdconfig) {
			fullConfig[p] = config.amdconfig[p];
		}
		if (params.config) {
			var pageConfig = JSON.parse(params.config);
			for (p in pageConfig) {
				fullConfig[p] = pageConfig[p];
			}
		}
		if (request.method === "GET") {
			analyzer.getAnalysisData(modules, excludes, fullConfig, function(analysisData) {
				if (analysisData.failure) {
					var err = "Exception on request for ["+ params.modules + "] "+analysisData.failure; 
					console.log(err);
					response.write("alert('"+err+"');");
					response.end();
					return;
				} else if (analysisData.missingExclude) {
                	console.log("Request for ["+params.modules+"] failed. Anaylysis with exclude key ["+analysisData.missingExclude+"] could not be located");
					response.write("location.reload(true);");
					response.end();
				} else {
					var ifNoneMatch = request.headers["if-none-match"];
					if (ifNoneMatch !== undefined  && ifNoneMatch === analysisData.checksum) {
						response.writeHead(304, {'Content-Type': 'text/javascript; charset=UTF-8'}); 
						response.end();
						return;
					}
					response.setHeader('ETag', analysisData.checksum);
					response.setHeader('Content-Type', 'text/javascript; charset=UTF-8');
					var responseWriter = new HttpResponseWriter(request, response);
					writeResponse(params.writeBootstrap, analysisData, excludes, responseWriter, config, compress, request.headers["accept-language"], true);
				}
			});
		} else if (request.method === "HEAD") {
			var key = analyzer.getKey(modules, excludes, fullConfig);
			if (analyzer.analysisInProcess(key) === true) {
				response.statusCode = 404; 
				response.end();
			} else {
				var analysisData = analyzer.getAnalysisDataFromKey(key);
				if (analysisData) {
					var ifNoneMatch = request.headers["if-none-match"];
					if (ifNoneMatch !== undefined  && ifNoneMatch === analysisData.checksum) {
						response.writeHead(304, {'Content-Type': 'text/javascript; charset=UTF-8'}); 
					} else {
						response.setHeader('ETag', analysisData.checksum);
						response.setHeader('Content-Type', 'text/javascript; charset=UTF-8');
					}
					response.end();
				} else {
					analyzer.getAnalysisData(modules, excludes, fullConfig, function(analysisData) {});
					response.statusCode = 404; 
					response.end();
				}
			}
		}
	}
}

var Optimizer = function(params) {
	resourceloader.addProvider(params.appdir);
	this.compress = params.compress;
	resourceloader.readText("zazlConfig.json", function(configText) {
		var config = JSON.parse(configText);
		if (params.configpath) {
			fs.exists(params.configpath, function (exists) {
				if (exists) {
					fs.readFile(params.configpath, 'utf8', function(err, configText) {
						if (err) {
							console.log("Failed to read config file ["+params.configpath+"] err : "+err+" Using default config");
							this.config = config;
						} else {
							var userconfig = JSON.parse(configText);
							this.config = util.mixin(config, userconfig);
						}
						if (params.readycb) {
							params.readycb();
						}
					}.bind(this));
				} else {
					this.config = config;
					if (params.readycb) {
						params.readycb();
					}
				}
			}.bind(this));
		} else {
			this.config = config;
			if (params.readycb) {
				params.readycb();
			}
		}
	}.bind(this));
};

Optimizer.prototype = {
	handle: function(request, response) {
		var otherwiseCallback;
	    var errorCallback;
	    
		var handler = {
			otherwise : function(callback) {
				otherwiseCallback = callback;
				return handler;
			},
			error: function(callback) {
				errorCallback = callback;
				return handler;
			}
		};
		var scope = this;
		process.nextTick(function() {
			errorCallback = errorCallback || function(state) {
				response.writeHead(state, {'Content-Type': 'text/html'});
				response.end("<h1>HTTP " + state + "</h1>");
		    };
		    
		    otherwiseCallback = otherwiseCallback || function() {
				response.writeHead(404, {'Content-Type': 'text/html'});
				response.end("<h1>HTTP 404 File not found</h1>");
		    };
		    
			var requestURL = url.parse(request.url);
			if (requestURL.pathname.match("^/_javascript")) {
				handle(request, response, scope.config, scope.compress);
			} else {
				otherwiseCallback();
			}
		});
		return handler;
	},
	optimize: function(modules, config, excludes, cb) {
		var fullConfig = {};
		for (p in this.config.amdconfig) {
			fullConfig[p] = this.config.amdconfig[p];
		}
		for (p in config) {
			fullConfig[p] = config[p];
		}
		if (!fullConfig.map) {
			fullConfig.map = {};
		}
		analyzer.getAnalysisData(modules, excludes, fullConfig, function(analysisData) {
			if (analysisData.failure) {
				var err = "Exception on request for ["+ modules + "] "+analysisData.failure; 
				console.log(err);
				cb({failure: err});
			} else if (analysisData.missingExclude) {
				var err = "Request for ["+modules+"] failed. Anaylysis with exclude key ["+analysisData.missingExclude+"] could not be located";
				console.log(err);
				cb({failure: err});
			} else {
				var writer = new StringWriter(function(output) {
					cb({analysisData: analysisData, output: output});
				});
				writeResponse(false, analysisData, excludes, writer, this.config, this.compress, "us-en", false);
			}
		}.bind(this));
	}
};

exports.createOptimizer = function(appdir, compress, readycb) {
	var params;
	if (util.isObject(appdir)) {
		params = appdir;
	} else {
		params = {
			appdir: appdir,
			compress: compress,
			readycb: readycb
		};
	}

	return new Optimizer(params);
};

var ConnectOptimizer = function(appdir, compress) {
	resourceloader.addProvider(appdir);
	this.compress = compress;
	resourceloader.readText("zazlConfig.json", function(configText) {
		this.config = JSON.parse(configText);
	}.bind(this));
};

ConnectOptimizer.prototype = {
	handle: function(request, response, next) {
		handle(request, response, this.config, this.compress);
	}
};

exports.createConnectOptimizer = function(appdir, compress) {
	return new ConnectOptimizer(appdir, compress);
};

exports.getLoaderDir = function() {
	return path.normalize(__dirname+"/..");
};
