/*
    Copyright (c) 2004-2011, The Dojo Foundation All Rights Reserved.
    Available via Academic Free License >= 2.1 OR the modified BSD license.
    see: http://dojotoolkit.org/license for details
*/
var Module = function(id, uri) {
	this.id = id;
	this.uri = uri;
	this.defineFound = false;
	this.dependencies = [];
};

Module.prototype = {
	addDependency: function(dependency) {
		if (this.dependencies.indexOf(dependency) < 0) {
			this.dependencies.push(dependency);
		}
	}
};

exports.createModule = function(id, uri) {
	return new Module(id, uri);
};