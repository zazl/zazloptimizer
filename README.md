## zazloptimizer

Node.js version of the Zazl Optimizer (http://zazl.org)
Zazl is a Dynamic Javascript Optimizer that enables the loading of AMD modules and all their dependencies in a single response stream without depending on static build tools. 

## Install it via npm

	npm install zazloptimizer

## Usage

To try it out you can load 2 sample projects stored on github

[Dojo Samples] (https://github.com/zazl/zazl-dojo-samples)
[JQuery Samples] (https://github.com/zazl/zazl-jquery-samples)

Both of these are also hosted as Heroku apps

[Dojo Samples App] (http://zazl-dojo-samples.herokuapp.com/)
[JQuery Samples App] (http://zazl-jquery-samples.herokuapp.com/)

Note: The hosting site (Heroku) puts both apps to sleep after being idle for 1hour. Don't be surprised if the first load(s) takes some time. 
Subsequent loads will demonstrate the full potential.

Alternatively you can download the standalone dojo samples [examples](http://www.zazl.org/downloads/latest/examples.zip), create an examples directory and unzip it into that. 

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
    