/*
    Copyright (c) 2004-2013, The Dojo Foundation All Rights Reserved.
    Available via Academic Free License >= 2.1 OR the modified BSD license.
    see: http://dojotoolkit.org/license for details
*/
exports.createCallback = function(limit, fn) {
	var complete = 0;
	return function() {
		if (++complete === limit) {
			fn();
		}
	};
};

var isObject = function(arg) {
  return typeof arg === 'object' && arg !== null;
};

exports.isObject = isObject;

var mixin = function(obj1, obj2) {
	for (var p in obj2) {
    	try {
			if (obj2[p].constructor == Object) {
        		obj1[p] = mixin(obj1[p], obj2[p]);
			} else {
				obj1[p] = obj2[p];
			}
		} catch(e) {
			obj1[p] = obj2[p];
		}
	}
	return obj1;
};

exports.mixin = mixin;
