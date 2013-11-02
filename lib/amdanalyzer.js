/*
    Copyright (c) 2004-2013, The Dojo Foundation All Rights Reserved.
    Available via Academic Free License >= 2.1 OR the modified BSD license.
    see: http://dojotoolkit.org/license for details
*/

var esprima = require("esprima/esprima");
var resourceloader = require('./resourceloader');
var map = require("./map");
var moduleCreator = require("./module");
var util = require("./util");

var opts = Object.prototype.toString;
function isArray(it) { return opts.call(it) === "[object Array]"; }

function getParentId(pathStack) {
	return pathStack.length > 0 ? pathStack[pathStack.length-1] : "";
}

function countSegments(path) {
	var count = 0;
	for (var i = 0; i < path.length; i++) {
		if (path.charAt(i) === '/') {
			count++;
		}
	}
	return count;
}

function normalize(path) {
	var segments = path.split('/');
	var skip = 0;

	for (var i = segments.length; i >= 0; i--) {
		var segment = segments[i];
		if (segment === '.') {
			segments.splice(i, 1);
		} else if (segment === '..') {
			segments.splice(i, 1);
			skip++;
		} else if (skip) {
			segments.splice(i, 1);
			skip--;
		}
	}
	return segments.join('/');
}

function scanForRequires(ast, requires) {
	for (var p in ast) {
		if (p === "type" && ast[p] === "CallExpression" && ast["callee"]) {
			var callee = ast["callee"];
			if (callee.name && callee.name === "require") {
				var arg1 = ast["arguments"][0];
				if (arg1.type === "Literal") {
					requires.push(arg1.value);
				}
			}
		}
		if (isArray(ast[p])) {
			var a = ast[p];
			for (var i = 0; i < a.length; i++) {
				if (typeof a[i] === 'object') {
					scanForRequires(a[i], requires);
				}
			}
		} else if (typeof ast[p] === 'object') {
			scanForRequires(ast[p], requires);
		}
	}
}

function getDependencies(src, expression, scanCJSRequires) {
	var dependencies = [];
	var nameIndex;

	var args = expression["arguments"];
	for (var j = 0; j < args.length; j++) {
		if (j === 0 && args[j].type !== "Literal") {
			nameIndex = args[j].range[0];
		}
		if (args[j].type === "ArrayExpression" && expression.callee.name === "define") {
			var elements = args[j].elements;
			for (var k = 0; k < elements.length; k++) {
				dependencies.push({value: elements[k].value, type: elements[k].type});
			}
		} else if (args[j].type === "FunctionExpression" && expression.callee.name === "define") {
			if (scanCJSRequires) {
				var requires = [];
				scanForRequires(args[j].body, requires);
				for (var x = 0; x < requires.length; x++) {
					dependencies.push({value: requires[x], type: "Literal"});
				}
			}
		}
	}

	return {deps:dependencies, nameIndex: nameIndex};
}

function findDefine(ast) {
	var expr;
	for (var p in ast) {
		if (p === "type" && ast[p] === "CallExpression") {
			var callee = ast.callee;
			var args = ast["arguments"];
			if (callee && callee.type === "Identifier" && callee.name && callee.name === "define") {
				return {arguments: args, callee: {name: "define"}};
			} else if (callee && callee.type === "ConditionalExpression") {
				var left = {type : callee.consequent.type, name : callee.consequent.name === undefined ? "" : callee.consequent.name};
				var right = {type : callee.alternate.type, name : callee.alternate.name === undefined ? "" : callee.alternate.name};
				if ((left.type === "Identifier" && left.name === "define") || (right.type === "Identifier" && right.name === "define")) {
					return {arguments: args, callee: {name: "define"}};
				}
			}
		} else {
			if (isArray(ast[p])) {
				var a = ast[p];
				for (var i = 0; i < a.length; i++) {
					if (typeof a[i] === 'object') {
						expr = findDefine(a[i]);
						if (expr) {
							return expr;
						}
					}
				}
			} else if (typeof ast[p] === 'object') {
				expr = findDefine(ast[p]);
				if (expr) {
					return expr;
				}
			}
		}
	}
	return expr;
}

function isExcluded(exclude, item) {
	for (var i = 0; i < exclude.length; i++) {
		if (item === exclude[i]) {
			return true;
		}
	}
	return false;
}

var Analyzer = function(cfg) {
	this.config = {paths: {}, pkgs: {}, baseUrl: ""};
	var p;
	if (cfg) {
		if (cfg.paths) {
			for (p in cfg.paths) {
				var path = cfg.paths[p];
				this.config.paths[p] = path;
			}
		}
		if (cfg.packages) {
			for (var i = 0; i < cfg.packages.length; i++) {
				var pkg = cfg.packages[i];
				if (!pkg.location) {
					pkg.location = pkg.name;
				}
				if (!pkg.main) {
					pkg.main = "main";
				}
				this.config.pkgs[pkg.name] = pkg;
			}
		}
		if (cfg.baseUrl) {
			this.config.baseUrl = cfg.baseUrl;
		}
		for (p in cfg) {
			if (p !== "paths" && p !== "packages" && p !== 'baseUrl') {
				this.config[p] = cfg[p];
			}
		}
		this.config.scanCJSRequires = cfg.scanCJSRequires || false;
	}
};

Analyzer.prototype = {
	_findMapping: function(path, depId) {
		var cfg = this.config;
		var mapping;
		var segmentCount = -1;
		for (var id in cfg.map) {
			if (depId.indexOf(id) === 0) {
				var foundSegmentCount = countSegments(id);
				if (foundSegmentCount > segmentCount) {
					var mapEntry = cfg.map[id];
					if (mapEntry[path] !== undefined) {
						mapping = mapEntry[path];
						segmentCount = foundSegmentCount;
					}
				}
			}
		}
		if (mapping === undefined && cfg.map["*"] !== undefined && cfg.map["*"][path] !== undefined) {
			mapping = cfg.map["*"][path];
		}
		return mapping;
	},
	
	_idToUrl: function(path) {
		var config = this.config;
		var segments = path.split("/");
		for (var i = segments.length; i >= 0; i--) {
			var pkg;
			var parent = segments.slice(0, i).join("/");
			if (config.paths[parent]) {
				segments.splice(0, i, config.paths[parent]);
				break;
			}else if ((pkg = config.pkgs[parent])) {
				var pkgPath;
				if (path === pkg.name) {
					pkgPath = pkg.location + '/' + pkg.main;
				} else {
					pkgPath = pkg.location;
				}
				segments.splice(0, i, pkgPath);
				break;
			}
		}
		path = segments.join("/");
		if (path.charAt(0) !== '/') {
			path = config.baseUrl + path;
		}
		path = normalize(path);
		return path;
	},
	
	_expand: function(path, pathStack) {
		var config = this.config;
		var isRelative = path.search(/^\./) === -1 ? false : true;
		if (isRelative) {
			var pkg;
			if ((pkg = config.pkgs[getParentId(pathStack)])) {
				path = pkg.name + "/" + path;
			} else {
				path = getParentId(pathStack) + "/../" + path;
			}
			path = normalize(path);
		}
		var pkgName;
		for (pkgName in config.pkgs) {
			if (path === pkgName) {
				return config.pkgs[pkgName].name + '/' + config.pkgs[pkgName].main;
			}
		}

		var segments = path.split("/");
		for (var i = segments.length; i >= 0; i--) {
			var parent = segments.slice(0, i).join("/");
			var mapping = this._findMapping(parent, getParentId(pathStack), config);
			if (mapping) {
				segments.splice(0, i, mapping);
				return segments.join("/");
			}
		}

		return path;
	},
	
	_processPluginWrite: function(plugin, pluginName, resourceName, pathStack, cb) {
		var normalizedName = this._expand(resourceName, pathStack);
		var moduleUrl = this._idToUrl(normalizedName);
		plugin.write(pluginName, normalizedName, function(writeOutput) {
			cb(normalizedName, moduleUrl, writeOutput);
		}, moduleUrl);
	},
	
	_processPluginNormalize: function(plugin, resourceName, pathStack) {
		var normalizedName, dependency;
		normalizedName = dependency = plugin.normalize(resourceName, this.config, function(id) {
			return this._expand(id, pathStack);
		}.bind(this));
		if (normalizedName === undefined) {
			normalizedName = this._expand(resourceName, pathStack);
		}
		return {normalizedName: normalizedName, dependency: dependency};
	},

	_processPluginRef: function(pluginName, resourceName, pathStack, cb) {
		var value;
		var normalizedName;
		var dependency;
		var moduleUrl;
		if (this.config.plugins[pluginName]) {
			try {
				var plugin = require(this.config.plugins[pluginName].proxy);
				if (plugin.write) {
					this._processPluginWrite(plugin, pluginName, resourceName, pathStack, function(_normalizedName, _moduleUrl, _value) {
						normalizedName = _normalizedName;
						moduleUrl = _moduleUrl;
						value = _value;
						if (plugin.normalize) {
							var normalized = this._processPluginNormalize(plugin, resourceName, pathStack);
							normalizedName = normalized.normalizedName;
							dependency = normalized.dependency;
							moduleUrl = this._idToUrl(normalizedName);
							cb({name:resourceName, normalizedName: normalizedName, value: value, dependency: dependency, moduleUrl : moduleUrl});
						} else {
							cb({name:resourceName, normalizedName: normalizedName, value: value, dependency: dependency, moduleUrl : moduleUrl});
						}
					}.bind(this));
				} else if (plugin.normalize) {
					var normalized = this._processPluginNormalize(plugin, resourceName, pathStack);
					normalizedName = normalized.normalizedName;
					dependency = normalized.dependency;
					moduleUrl = this._idToUrl(normalizedName);
					cb({name:resourceName, normalizedName: normalizedName, value: value, dependency: dependency, moduleUrl : moduleUrl});
				} else {
					cb({name:resourceName, normalizedName: normalizedName, value: value, dependency: dependency, moduleUrl : moduleUrl});
				}
			} catch (exc) {
				console.log("Unable to process plugin ["+pluginName+"]:"+exc);
				cb({name:resourceName, normalizedName: normalizedName, value: value, dependency: dependency, moduleUrl : moduleUrl});
			}
		} else {
			normalizedName = this._expand(resourceName, pathStack);
			moduleUrl = this._idToUrl(normalizedName);
			cb({name:resourceName, normalizedName: normalizedName, value: value, dependency: dependency, moduleUrl : moduleUrl});
		}
	},
	
	_processShimDependencies: function(shim, exclude, pathStack, cb) {
		if (shim.deps) {
			var shimDeps = shim.deps.slice();
			var callback = function() {
				var shimDep = shimDeps.shift();
				if (!shimDep) {
					cb();
					return;
				}
				this._walk(shimDep, exclude, pathStack, function() {
					callback();
				});
			}.bind(this);
			callback();
		} else {
			cb();
		}
	},
	
	_findShim: function(module, exclude, pathStack) {
		var shim;
		if (this.config.shim) {
			shim = this.config.shim[module.id];
			if (shim) {
				if (isArray(shim)) {
					shim = {deps: shim};
				}
				var shimContent = "\n(function(root, cfg) {\ndefine('";
				shimContent += module.id;
				shimContent += "', ";
				if (shim.deps) {
					shimContent += "[";
					for (var i = 0; i < shim.deps.length; i++) {
						var shimDepUri = this._idToUrl(shim.deps[i]);
						if (shimDepUri.charAt(0) !== '/') {
							shimDepUri = '/'+shimDepUri;
						}
						if (isExcluded(exclude, shimDepUri) === false) {
							module.addDependency(shim.deps[i]);
							shimContent += "'";
							shimContent += shim.deps[i];
							shimContent += "'";
							if (i < (shim.deps.length-1)) {
								shimContent += ",";
							}
						}
					}
					shimContent += "], ";
				}
				shimContent += "function() {\n";
				if (shim.init) {
					shimContent += "\tvar initFunc = cfg.shim['"+module.id+"'].init;\n";
					shimContent += "\tvar initRet = initFunc.apply(root, arguments);\n";
					if (shim.exports) {
						shimContent += "\tif (initRet) { return initRet; } else { return root." + shim.exports + "; }\n";
					} else {
						shimContent += "\tif (initRet) { return initRet; } else { return {}; }\n";
					}
				} else if (shim.exports) {
					shimContent += "return root." + shim.exports + ";\n";
				}
				shimContent += "});\n}(this, zazl._getConfig()));\n";
				this.shims[module.uri] = shimContent;
			}
		}
		return shim;
	},
	
	_buildDependencyList: function(module, dependencyList, seen) {
		if (seen[module.uri] === undefined) {
			seen[module.uri] = module.uri;
			for (var i = 0; i < module.dependencies.length; i++) {
				var moduleDependency = this.moduleMap.get(module.dependencies[i]);
				if (moduleDependency !== undefined) {
					this._buildDependencyList(moduleDependency, dependencyList, seen);
				}
			}
			dependencyList.push(module.uri);
		}
	},
		
	_scanForCircularDependencies: function(module, check) {
        check.push(module.id);
		for (var i = 0; i < module.dependencies.length; i++) {
			var moduleDependency = this.moduleMap.get(module.dependencies[i]);
			if (!moduleDependency) {
				break;
			}
            if (moduleDependency.scanned !== undefined) {
                continue;
            }
            var found = false;
            var dup;
            for (var j = 0; j < check.length; j++) {
                if (check[j] === moduleDependency.id) {
                    found = true;
                    dup = moduleDependency.id;
                    break;
                }
            }
            if (found) {
                var msg = "Circular dependency found : ";
                for (j = 0; j < check.length; j++) {
                    msg += check[j];
                    msg += "->";
                }
                console.log(msg+dup);
            } else {
                this._scanForCircularDependencies(moduleDependency, check);
            }
		}
        module.scanned = true;
        check.pop();
	},
	
	_handlePluginRef: function(uri, exclude, pathStack, module, cb) {
		var pluginName = uri.substring(0, uri.indexOf('!'));
		pluginName = this._expand(pluginName, pathStack);
		var pluginValue = uri.substring(uri.indexOf('!')+1);
		if (this.pluginRefList[pluginName] === undefined) {
			this.pluginRefList[pluginName] = [];
		}
		this._processPluginRef(pluginName, pluginValue, pathStack, function(pluginRef) {
			if (pluginRef.dependency) {
				var dependencyUri = this._idToUrl(pluginRef.dependency);
				if (dependencyUri.charAt(0) !== '/') {
					dependencyUri = '/'+dependencyUri;
				}
				if (isExcluded(exclude, dependencyUri) === false) {
					if (module) {
						module.addDependency(pluginRef.dependency);
					}
					this._walk(pluginRef.dependency, exclude, [uri], function() {
						this.pluginRefList[pluginName].push(pluginRef);
						cb(pluginName);
					}.bind(this));
				} else {
					this.pluginRefList[pluginName].push(pluginRef);
					cb(pluginName);
				}
			} else {
				this.pluginRefList[pluginName].push(pluginRef);
				cb(pluginName);
			}
		}.bind(this));
	},
	
	_walkDependency: function(uri, type, dependency, exclude, module, pathStack, cb) {
		if (type !== "literal" &&
			dependency !== this.config.baseUrl+"require" &&
			dependency !== this.config.baseUrl+"exports" &&
			dependency !== this.config.baseUrl+"module") {
			pathStack.push(uri);
			dependency = this._expand(dependency, pathStack);
			var dependencyUri = this._idToUrl(dependency);
			if (dependencyUri.charAt(0) !== '/') {
				dependencyUri = '/'+dependencyUri;
			}
			if (isExcluded(exclude, dependencyUri) === false) {
				module.addDependency(dependency);
				this._walk(dependency, exclude, pathStack, function() {
					pathStack.pop();
					cb();
				});
			} else {
				pathStack.pop();
				cb();
			}
		} else {
			cb();
		}
	},
	
	_walkDependencies: function(uri, exclude, pathStack, cb) {
		var url = this._idToUrl(uri);
		if (url.charAt(0) !== '/') {
			url = '/'+url;
		}
					
		if (this.moduleMap.get(uri) === undefined) {
			resourceloader.readText(url+'.js', function (src) {
				if (!src) {
					var err = "Unable to load src for ["+url+"]. Module ["+(pathStack.length > 0 ? pathStack[pathStack.length-1] : "root")+"] has a dependency on it.";
					console.log(err);
					cb(err);
					return;
				}
				try {
					var ast = esprima.parse(src, {range: true});
				} catch (e) {
					var err = "Failed to parse ["+url+"] : "+e.toString();
					console.log(err);
					cb(err);
					return;
				}
				var defineExpr = findDefine(ast);
				var id = uri;
				var module = moduleCreator.createModule(id, url);
				//console.log("add : "+uri + " parent : "+(pathStack.length > 0 ? pathStack[pathStack.length-1] : "root"));
				this.moduleMap.add(uri, module);
				if (defineExpr === undefined) {
					var shim = this._findShim(module, exclude, pathStack);
					if (shim) {
						this._processShimDependencies(shim, exclude, pathStack, function() {
							cb();
						});
					} else {
						cb();
					}
				} else {
					module.defineFound = true;
					var depInfo = getDependencies(src, defineExpr, this.config.scanCJSRequires);
					if (depInfo.nameIndex) {
						this.missingNamesList.push({uri: url, id: id, nameIndex: depInfo.nameIndex});
					}

					var callback = function() {
						var dep = depInfo.deps.shift();
						if (!dep) {
							cb();
							return;
						}
						var dependency = dep.value;
						//console.log("uri : ["+uri + "] dep : ["+dependency+"]");
						if (dependency.match(".+!")) {
							pathStack.push(uri);
							this._handlePluginRef(dependency, exclude, pathStack, module, function(pluginName) {
								pathStack.pop();
								this._walkDependency(uri, dep.type, pluginName, exclude, module, pathStack, function() {
									callback();
								});
							}.bind(this));
						} else {
							this._walkDependency(uri, dep.type, dependency, exclude, module, pathStack, function() {
								callback();
							});
						}
					}.bind(this);
					callback();
				}
			}.bind(this));			
		} else {
			cb();
		}
	},
	
	_walk: function(uri, exclude, pathStack, cb) {
		if (uri === "require" || uri === "exports" || uri === "module") {
			this.moduleMap.add(uri, moduleCreator.createModule(uri, uri));
			cb();
			return;
		}
		
		if (uri.match(".+!")) {
			this._handlePluginRef(uri, exclude, pathStack, undefined, function(pluginName) {
				this._walkDependencies(pluginName, exclude, pathStack, cb);
			}.bind(this));
		} else {
			uri = this._expand(uri, pathStack);
			this._walkDependencies(uri, exclude, pathStack, cb);
		}
	},
	
	_analyze: function(modules, exclude, cb) {
		this.pluginRefList = {};
		this.missingNamesList = [];
		this.shims = {};
		this.moduleMap = map.createMap();
		
		var _modules = modules.slice();
		var callback = function() {
			var module = _modules.shift();
			if (!module) {
				cb();
				return;
			}
			console.log("AST parsing ["+module+"]");
			this._walk(module, exclude, [], function(failed) {
				if (failed) {
					cb(failed);
				} else {
					callback();
				}
			});
		}.bind(this);
		callback();
	},
	
	getDependencyList: function(modules, exclude, cb) {
		this._analyze(modules, exclude, function(failed) {
			if (failed) {
				cb(failed);
			} else {
				var dependencyList = [];
				var seen = {require: "require", module: "module", exports: "exports"};
				var i, module;
				for (i = 0; i < modules.length; i++) {
					var m = modules[i];
					if (m.match(".+!")) {
						m = m.substring(0, m.indexOf('!'));
					}
					m = this._expand(m, []);
					module = this.moduleMap.get(m);
					this._buildDependencyList(module, dependencyList, seen);
					this._scanForCircularDependencies(module, []);
				}
				var allmodules = this.moduleMap.values();
				for (i = 0; i < allmodules.length; i++) {
					module = allmodules[i];
					if (module.defineFound === false && this.shims[module.uri] === undefined) {
						var shimContent = "\n(function(root, cfg) {\ndefine('";
						shimContent += module.id;
						shimContent += "', ";
						shimContent += "function() {\n";
						shimContent += "});\n}(this, zazl._getConfig()));\n";
						this.shims[module.uri] = shimContent;
					}
				}
				cb(dependencyList);
			}
		}.bind(this));
	},
	
	getAnalysisData: function(modules, exclude, cb) {
		this.getDependencyList(modules, exclude, function(dependencyList) {
			if (isArray(dependencyList)) {
				cb({dependencyList: dependencyList, pluginRefs: this.pluginRefList, missingNamesList: this.missingNamesList, shims: this.shims});
			} else {
				cb({failure: dependencyList});
			}
		}.bind(this));
	}
};


exports.createAnalyzer = function(config) {
	return new Analyzer(config);
};
