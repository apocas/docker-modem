var Client = require('ssh2').Client,
  http = require('http');

module.exports = function (opt) {
  var conn = new Client();
  var agent = new http.Agent();

  agent.createConnection = function (options, fn) {
    try {
      conn.once('ready', function () {
        conn.exec('docker system dial-stdio', function (err, stream) {
          if (err) {
            handleError(err);
          }

          fn(null, stream);
          
          stream.addListener('error', (err) => {
            handleError(err);
          });
          stream.once('close', () => {
            conn.end();
            agent.destroy();
          });
        });
      }).on('error', (err) => {
        handleError(err);
      })
        .connect(opt);
      conn.once('end', () => agent.destroy());
      
    } catch (err) {
      handleError(err);
    }
  };

  function handleError(err) {
    conn.end();
    agent.destroy();
    throw err;
  }

  return agent;
};
