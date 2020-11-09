var Client = require('ssh2').Client,
  http = require('http');
var debug = require('debug')('modem.ssh');

module.exports = function(opt) {
  var conn = new Client();
  var agent = new http.Agent();

  agent.createConnection = function(options, fn) {
    debug('createConnection');
    conn.once('ready', function() {
      debug('ready');
      conn.exec('docker system dial-stdio', function(err, stream) {
        debug("dialed")
        if (err) {
          debug('error');
          conn.end();
          agent.destroy();
          return;
        }

        fn(null, stream);

        stream.once('close', () => {
          debug('close');
          conn.end();
          agent.destroy();
        });
      });
    }).connect(opt);

    conn.once('end', () => {
      debug('end')
      agent.destroy()
    });
  };

  return agent;
};
