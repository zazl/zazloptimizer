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
