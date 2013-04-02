## zazloptimizer

Node.js version of the Zazl Optimizer (http://zazl.org)

## Install it via npm

	npm install zazloptimizer

## Usage

To try it out you can download the available [examples](http://www.zazl.org/downloads/latest/examples.zip), create an examples directory and unzip it into that. 

To run via [Connect](http://www.senchalabs.org/connect/) run the following :

    node lib/zazlconnect.js examples

To run on a different port : 

    node lib/zazlconnect.js examples 9080

To turn off **javascript compression** (on by default, via uglify-js) :

    node lib/zazlconnect.js examples 9080 false

There are some samples available in the **examples.zip** that use direct injection for script loading.

    http://localhost:8080/inject_amdcalendar.html

    http://localhost:8080/inject_amddeclarative.html
    
    http://localhost:8080/inject_amdmultirequire.html
        
    http://localhost:8080/inject_amdlazyload.html
    
## Project Integration

To see how to integrate the Node.js version of the optimizer into you connect based application take a look at [mpdjs](https://github.com/rbackhouse/mpdjs)
    