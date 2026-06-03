#!/usr/bin/env node
function test() {console.log("test2");}
function getTime() {
    return new Date().getTime();
    console.log("getTime");
}

//////////////type note


function runTest() {
    test();
    getTime();
}

module.exports = { test, getTime, runTest };