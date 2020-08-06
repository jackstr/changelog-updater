"use strict";
var core = require('@actions/core');
var github = require('@actions/github');
try {
    // `who-to-greet` input defined in action metadata file
    var nameToGreet = core.getInput('who-to-greet');
    console.log("Hello " + nameToGreet + "!");
    var time = (new Date()).toTimeString();
    core.setOutput("time", time);
    // Get the JSON webhook payload for the event that triggered the workflow
    var payload = JSON.stringify(github.context.payload, undefined, 2);
    console.log("The event payload: " + payload);
}
catch (error) {
    core.setFailed(error.message);
}
