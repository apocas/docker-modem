var Client = require('ssh2').Client,
  http = require('http');
var debug = require('debug')('modem.ssh');

module.exports = function(opt) {
  var agent = new http.Agent();
  var conn = new Client();
  var ready = false;

  agent.createConnection = function(options, fn) {
    debug('createConnection')
    if (ready) {
      dial(conn, fn);
    } else {
      conn.once('ready', function() {
        ready = true;
        debug('ready');
        dial(conn, fn);
      }).connect(opt);
    }
  };

  agent.destroy_without_ssh = agent.destroy;
  agent.destroy = function() {
    conn.end();
    agent.destroy_without_ssh();
  }

  return agent;
};

function dial(conn, fn) {
  conn.exec('docker system dial-stdio', function(err, stream) {
    debug('dialed')
    if (err) {
      debug('error');
      return;
    }

    fn(null, stream);

    stream.once('close', () => {
      debug('close')
      stream.end();
    });
  });
}
