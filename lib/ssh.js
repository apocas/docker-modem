var Client = require('ssh2').Client,
  http = require('http');
var debug = require('debug')('modem.ssh');

module.exports = function(opt) {
  var agent = new http.Agent();

  agent.createConnection = function(options, fn) {
    debug('createConnection');
    var conn = new Client();
    conn.once('ready', function() {
      debug('ready');
      conn.exec('docker system dial-stdio', function(err, stream) {
        debug("dialed")
        if (err) {
          debug('error');
          conn.end();
          return;
        }

        fn(null, stream);

        stream.once('close', () => {
          debug('close');
          conn.end();
        });
      });
    }).connect(opt);
  };

  return agent;
};
