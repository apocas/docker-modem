var querystring = require('querystring'),
  http = require('follow-redirects'),
  fs = require('fs'),
  p = require('path'),
  url = require('url'),
  stream = require('readable-stream'),
  HttpDuplex = require('./http_duplex'),
  debug = require('debug')('modem'),
  util = require('util');


var Modem = function(opts) {
  this.socketPath = opts.socketPath;
  this.host = opts.host;
  this.protocol = opts.protocol || 'http';
  this.port = opts.port;
  this.version = opts.version;
  this.key = opts.key;
  this.cert = opts.cert;
  this.ca = opts.ca;
  this.timeout = opts.timeout;
};

Modem.prototype.dial = function(options, callback) {
  var opts, address, data;
  var self = this;

  if (options.options) {
    opts = options.options;
  }

  if(this.version) {
    options.path = '/' + this.version + options.path;
  }

  if(this.host) {
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


  if(options.path.indexOf('?') !== -1) {
    if (opts && Object.keys(opts).length > 0) {
      address += querystring.stringify(opts);
    } else {
      address = address.substring(0, address.length - 1);
    }
  }

  var optionsf = {
    path: address,
    method: options.method,
    headers: {},
    key: self.key,
    cert: self.cert,
    ca: self.ca
  };

  if(options.authconfig) {
    optionsf.headers['X-Registry-Auth'] = new Buffer(JSON.stringify(options.authconfig)).toString('base64');
  }

  if(options.file) {
    if (typeof options.file === 'string') {
      data = fs.readFileSync(p.resolve(options.file));
    } else {
      data = options.file;
    }
    optionsf.headers['Content-Type'] = 'application/tar';
  } else if(opts && options.method === 'POST') {
    data = JSON.stringify(opts);
    optionsf.headers['Content-Type'] = 'application/json';
  }

  if(typeof data === "string") {
    optionsf.headers['Content-Length'] = Buffer.byteLength(data);
  } else if(Buffer.isBuffer(data) === true) {
    optionsf.headers['Content-Length'] = data.length;
  }

  if(this.socketPath) {
    optionsf.socketPath = this.socketPath;
  } else {
    var urlp = url.parse(address);
    optionsf.hostname = urlp.hostname;
    optionsf.port = urlp.port;
    optionsf.path = urlp.path;
  }

  this.buildRequest(optionsf, options, data, callback);
};

Modem.prototype.buildRequest = function(options, context, data, callback) {
  var self = this;
  var req = http[self.protocol].request(options, function() {});

  debug('Sending: %s', util.inspect(options, { showHidden: true, depth: null }));

  if(self.timeout) {
    req.on('socket', function (socket) {
      socket.setTimeout(self.timeout);
      socket.on('timeout', function() {
        req.abort();
      });
    });
  }

  req.on('response', function(res) {
    if (context.isStream === true) {
      self.buildPayload(null, context.isStream, context.statusCodes, context.openStdin, req, res, null, callback);
    } else {
      var chunks = '';
      res.on('data', function(chunk) {
        chunks += chunk;
      });

      res.on('end', function() {
        debug('Received: %s', chunks);

        var json;
        try {
          json = JSON.parse(chunks);
        } catch(e) {
          json = chunks;
        }
        self.buildPayload(null, context.isStream, context.statusCodes, false, req, res, json, callback);
      });
    }
  });

  req.on('error', function(error) {
    self.buildPayload(error, context.isStream, context.statusCodes, false, {}, {}, null, callback);
  });

  if(typeof data === "string" || Buffer.isBuffer(data)) {
    req.write(data);
  } else if(data) {
    data.pipe(req);
  }

  if (!context.openStdin && (typeof data === "string" || data === undefined || Buffer.isBuffer(data))) {
    req.end();
  }
};

Modem.prototype.buildPayload = function(err, isStream, statusCodes, openStdin, req, res, json, cb) {
  if (err) return cb(err, null);

  if (statusCodes[res.statusCode] !== true) {
    var msg = new Error(
      'HTTP code is ' + res.statusCode + ' which indicates error: ' + statusCodes[res.statusCode] + ' - ' + json
    );
    msg.reason = statusCodes[res.statusCode];
    msg.statusCode = res.statusCode;
    msg.json = json;
    cb(msg, null);
  } else {
    if (openStdin) {
      cb(null, new HttpDuplex(req, res));
    } else if (isStream) {
      cb(null, res);
    } else {
      cb(null, json);
    }
  }
};

Modem.prototype.demuxStream = function(stream, stdout, stderr) {
  var header = null;

  stream.on('readable', function() {
    header = header || stream.read(8);
    while(header !== null) {
      var type = header.readUInt8(0);
      var payload = stream.read(header.readUInt32BE(4));
      if (payload === null) break;
      if(type == 2) {
        stderr.write(payload);
      } else {
        stdout.write(payload);
      }
      header = stream.read(8);
    }
  });
};

module.exports = Modem;
