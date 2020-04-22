var querystring = require('querystring'),
  http = require('./http'),
  fs = require('fs'),
  path = require('path'),
  url = require('url'),
  ssh = require('./ssh'),
  HttpDuplex = require('./http_duplex'),
  debug = require('debug')('modem'),
  utils = require('./utils'),
  util = require('util'),
  url = require('url'),
  splitca = require('split-ca'),
  isWin = require('os').type() === 'Windows_NT';

var defaultOpts = function () {
  var host;
  var opts = {};

  if (!process.env.DOCKER_HOST) {
    // Windows socket path: //./pipe/docker_engine ( Windows 10 )
    // Linux & Darwin socket path: /var/run/docker.sock
    opts.socketPath = isWin ? '//./pipe/docker_engine' : '/var/run/docker.sock';
  } else if (process.env.DOCKER_HOST.indexOf('unix://') === 0) {
    // Strip off unix://, fall back to default of /var/run/docker.sock if
    // unix:// was passed without a path
    opts.socketPath = process.env.DOCKER_HOST.substring(7) || '/var/run/docker.sock';
  } else if (process.env.DOCKER_HOST.indexOf('npipe://') === 0) {
    // Strip off npipe://, fall back to default of //./pipe/docker_engine if
    // npipe:// was passed without a path
    opts.socketPath = process.env.DOCKER_HOST.substring(8) || '//./pipe/docker_engine';
  } else {
    var hostStr = process.env.DOCKER_HOST;
    if (hostStr.indexOf('\/\/') < 0) {
      hostStr = 'tcp://' + hostStr;
    }
    try {
      host = new url.URL(hostStr);
    } catch (err) {
      throw new Error('DOCKER_HOST env variable should be something like tcp://localhost:1234');
    }

    opts.port = host.port;

    if (process.env.DOCKER_TLS_VERIFY === '1' || opts.port === '2376') {
      opts.protocol = 'https';
    } else if (host.protocol === 'ssh:') {
      opts.protocol = 'ssh';
      opts.username = host.username;
      opts.sshOptions = {
        agent: process.env.SSH_AUTH_SOCK,
      }
    } else {
      opts.protocol = 'http';
    }

    opts.host = host.hostname;

    if (process.env.DOCKER_CERT_PATH) {
      opts.ca = splitca(path.join(process.env.DOCKER_CERT_PATH, 'ca.pem'));
      opts.cert = fs.readFileSync(path.join(process.env.DOCKER_CERT_PATH, 'cert.pem'));
      opts.key = fs.readFileSync(path.join(process.env.DOCKER_CERT_PATH, 'key.pem'));
    }

    if (process.env.DOCKER_CLIENT_TIMEOUT) {
      opts.timeout = parseInt(process.env.DOCKER_CLIENT_TIMEOUT, 10);
    }
  }

  return opts;
};


var Modem = function (options) {
  var optDefaults = defaultOpts();
  var opts = Object.assign({}, optDefaults, options);

  this.socketPath = opts.socketPath;
  this.host = opts.host;
  this.port = opts.port;
  this.username = opts.username;
  this.password = opts.password;
  this.version = opts.version;
  this.key = opts.key;
  this.cert = opts.cert;
  this.ca = opts.ca;
  this.timeout = opts.timeout;
  this.connectionTimeout = opts.connectionTimeout;
  this.checkServerIdentity = opts.checkServerIdentity;
  this.agent = opts.agent;
  this.headers = opts.headers || {};
  this.sshOptions = Object.assign({}, options ? options.sshOptions : {}, optDefaults.sshOptions);

  if (this.key && this.cert && this.ca) {
    this.protocol = 'https';
  }
  this.protocol = opts.protocol || this.protocol || 'http';
};

Modem.prototype.dial = function (options, callback) {
  var opts, address, data;
  var self = this;

  if (options.options) {
    opts = options.options;
  }

  // Prevent credentials from showing up in URL
  if (opts && opts.authconfig) {
    delete opts.authconfig;
  }

  if (this.version) {
    options.path = '/' + this.version + options.path;
  }

  if (this.host) {
    var parsed = url.parse(self.host);
    address = url.format({
      'protocol': parsed.protocol || self.protocol,
      'hostname': parsed.hostname || self.host,
      'port': self.port
    });
    address = url.resolve(address, options.path);
  } else {
    address = options.path;
  }

  if (options.path.indexOf('?') !== -1) {
    if (opts && Object.keys(opts).length > 0) {
      address += this.buildQuerystring(opts._query || opts);
    } else {
      address = address.substring(0, address.length - 1);
    }
  }

  var optionsf = {
    path: address,
    method: options.method,
    headers: options.headers || Object.assign({}, self.headers),
    key: self.key,
    cert: self.cert,
    ca: self.ca
  };

  if (this.checkServerIdentity) {
    optionsf.checkServerIdentity = this.checkServerIdentity;
  }

  if (this.agent) {
    optionsf.agent = this.agent;
  }

  if (options.authconfig) {
    optionsf.headers['X-Registry-Auth'] = options.authconfig.key || options.authconfig.base64 ||
      Buffer.from(JSON.stringify(options.authconfig)).toString('base64');
  }

  if (options.registryconfig) {
    optionsf.headers['X-Registry-Config'] = options.registryconfig.base64 ||
      Buffer.from(JSON.stringify(options.registryconfig)).toString('base64');
  }

  if (options.file) {
    if (typeof options.file === 'string') {
      data = fs.createReadStream(path.resolve(options.file));
    } else {
      data = options.file;
    }
    optionsf.headers['Content-Type'] = 'application/tar';
  } else if (opts && options.method === 'POST') {
    data = JSON.stringify(opts._body || opts);
    if (options.allowEmpty) {
      optionsf.headers['Content-Type'] = 'application/json';
    } else {
      if (data !== '{}' && data !== '""') {
        optionsf.headers['Content-Type'] = 'application/json';
      } else {
        data = undefined;
      }
    }
  }

  if (typeof data === 'string') {
    optionsf.headers['Content-Length'] = Buffer.byteLength(data);
  } else if (Buffer.isBuffer(data) === true) {
    optionsf.headers['Content-Length'] = data.length;
  } else if (optionsf.method === 'PUT' || options.hijack || options.openStdin) {
    optionsf.headers['Transfer-Encoding'] = 'chunked';
  }

  if (options.hijack) {
    optionsf.headers.Connection = 'Upgrade';
    optionsf.headers.Upgrade = 'tcp';
  }

  if (this.socketPath) {
    optionsf.socketPath = this.socketPath;
  } else {
    var urlp = url.parse(address);
    optionsf.hostname = urlp.hostname;
    optionsf.port = urlp.port;
    optionsf.path = urlp.path;
  }

  this.buildRequest(optionsf, options, data, callback);
};

Modem.prototype.buildRequest = function (options, context, data, callback) {
  var self = this;
  var connectionTimeoutTimer;

  var opts = self.protocol === 'ssh' ? Object.assign(options, {
    agent: ssh(Object.assign({}, self.sshOptions, {
      'host': self.host,
      'port': self.port,
      'username': self.username,
      'password': self.password,
    })),
    protocol: 'http:',
  }) : options;

  var req = http[self.protocol === 'ssh' ? 'http' : self.protocol].request(opts, function () { });

  debug('Sending: %s', util.inspect(options, {
    showHidden: true,
    depth: null
  }));

  if (self.connectionTimeout) {
    connectionTimeoutTimer = setTimeout(function () {
      debug('Connection Timeout of %s ms exceeded', self.connectionTimeout);
      req.abort();
    }, self.connectionTimeout);
  }

  if (self.timeout) {
    req.on('socket', function (socket) {
      socket.setTimeout(self.timeout);
      socket.on('timeout', function () {
        debug('Timeout of %s ms exceeded', self.timeout);
        req.abort();
      });
    });
  }

  if (context.hijack === true) {
    clearTimeout(connectionTimeoutTimer);
    req.on('upgrade', function (res, sock, head) {
      return callback(null, sock);
    });
  }

  req.on('connect', function () {
    clearTimeout(connectionTimeoutTimer);
  });

  req.on('disconnect', function () {
    clearTimeout(connectionTimeoutTimer);
  });

  req.on('response', function (res) {
    clearTimeout(connectionTimeoutTimer);
    if (context.isStream === true) {
      self.buildPayload(null, context.isStream, context.statusCodes, context.openStdin, req, res, null, callback);
    } else {
      var chunks = [];
      res.on('data', function (chunk) {
        chunks.push(chunk);
      });

      res.on('end', function () {
        var buffer = Buffer.concat(chunks);
        var result = buffer.toString();

        debug('Received: %s', result);

        var json = utils.parseJSON(result) || buffer;
        self.buildPayload(null, context.isStream, context.statusCodes, false, req, res, json, callback);
      });
    }
  });

  req.on('error', function (error) {
    clearTimeout(connectionTimeoutTimer);
    self.buildPayload(error, context.isStream, context.statusCodes, false, {}, {}, null, callback);
  });

  if (typeof data === 'string' || Buffer.isBuffer(data)) {
    req.write(data);
  } else if (data) {
    data.pipe(req);
  }

  if (!context.hijack && !context.openStdin && (typeof data === 'string' || data === undefined || Buffer.isBuffer(data))) {
    req.end();
  }
};

Modem.prototype.buildPayload = function (err, isStream, statusCodes, openStdin, req, res, json, cb) {
  if (err) return cb(err, null);

  if (statusCodes[res.statusCode] !== true) {
    getCause(isStream, res, json, function (err, cause) {
      var msg = new Error(
        '(HTTP code ' + res.statusCode + ') ' +
        (statusCodes[res.statusCode] || 'unexpected') + ' - ' +
        (cause.message || cause) + ' '
      );
      msg.reason = statusCodes[res.statusCode];
      msg.statusCode = res.statusCode;
      msg.json = json;
      cb(msg, null);
    });
  } else {
    if (openStdin) {
      cb(null, new HttpDuplex(req, res));
    } else if (isStream) {
      cb(null, res);
    } else {
      cb(null, json);
    }
  }

  function getCause(isStream, res, json, callback) {
    var chunks = '';
    if (isStream) {
      res.on('data', function (chunk) {
        chunks += chunk;
      });
      res.on('end', function () {
        callback(null, utils.parseJSON(chunks) || chunks);
      });
    } else {
      callback(null, json);
    }
  }
};

Modem.prototype.demuxStream = function (stream, stdout, stderr) {
  var nextDataType = null;
  var nextDataLength = null;
  var buffer = Buffer.from('');
  function processData(data) {
    if (data) {
      buffer = Buffer.concat([buffer, data]);
    }
    if (!nextDataType) {
      if (buffer.length >= 8) {
        var header = bufferSlice(8);
        nextDataType = header.readUInt8(0);
        nextDataLength = header.readUInt32BE(4);
        // It's possible we got a "data" that contains multiple messages
        // Process the next one
        processData();
      }
    } else {
      if (buffer.length >= nextDataLength) {
        var content = bufferSlice(nextDataLength);
        if (nextDataType === 1) {
          stdout.write(content);
        } else {
          stderr.write(content);
        }
        nextDataType = null;
        // It's possible we got a "data" that contains multiple messages
        // Process the next one
        processData();
      }
    }
  }

  function bufferSlice(end) {
    var out = buffer.slice(0, end);
    buffer = Buffer.from(buffer.slice(end, buffer.length));
    return out;
  }

  stream.on('data', processData);
};

Modem.prototype.followProgress = function (stream, onFinished, onProgress) {
  var buf = '';
  var output = [];
  var finished = false;

  stream.on('data', onStreamEvent);
  stream.on('error', onStreamError);
  stream.on('end', onStreamEnd);
  stream.on('close', onStreamEnd);

  function onStreamEvent(data) {
    buf += data.toString();
    pump();

    function pump() {
      var pos;
      while ((pos = buf.indexOf('\n')) >= 0) {
        if (pos == 0) {
          buf = buf.slice(1);
          continue;
        }
        processLine(buf.slice(0, pos));
        buf = buf.slice(pos + 1);
      }
    }

    function processLine(line) {
      if (line[line.length - 1] == '\r') line = line.substr(0, line.length - 1);
      if (line.length > 0) {
        var obj = JSON.parse(line);
        output.push(obj);
        if (onProgress) {
          onProgress(obj);
        }
      }
    }
  };

  function onStreamError(err) {
    finished = true;
    stream.removeListener('data', onStreamEvent);
    stream.removeListener('error', onStreamError);
    stream.removeListener('end', onStreamEnd);
    stream.removeListener('close', onStreamEnd);
    onFinished(err, output);
  }

  function onStreamEnd() {
    if(!finished) onFinished(null, output);
    finished = true;
  }
};

Modem.prototype.buildQuerystring = function (opts) {
  var clone = {};

  // serialize map values as JSON strings, else querystring truncates.
  Object.keys(opts).map(function (key, i) {
    clone[key] = opts[key] && typeof opts[key] === 'object' && key !== 't' ?
      JSON.stringify(opts[key]) : opts[key];
  });

  return querystring.stringify(clone);
};

module.exports = Modem;
