//Based on follow-redirects v0.0.x

var nativeHttps = require('https'),
  nativeHttp = require('http'),
  url = require('url'),
  util = require('./util');

var maxRedirects = module.exports.maxRedirects = 5;

var protocols = {
  https: nativeHttps,
  http: nativeHttp
};

for (var protocol in protocols) {
  var h = function() {};
  h.prototype = protocols[protocol];
  h = new h();







}
