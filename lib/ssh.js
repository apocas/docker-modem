var Client = require('ssh2').Client,
  http = require('http');

module.exports = function(opt) {
  var agent = new http.Agent();
  
  agent.createConnection = function(options, fn) {
    var conn = new Client();
    conn.once('ready', function() {
      conn.exec('docker system dial-stdio', function(err, stream) {
        if (err) {
          conn.end();
          agent.destroy();
          return;
        }

        fn(null, stream);

        stream.once('close', () => {
          conn.end();
          agent.destroy();
        });
      });
    }).connect(opt);

    conn.once('end', () => agent.destroy());
  };

  return agent;
};
