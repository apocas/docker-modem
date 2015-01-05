var assert = require('assert');
var Modem = require('../lib/modem');

describe('Modem', function () {
  beforeEach(function () { delete process.env.DOCKER_HOST; });

  it('should default to /var/run/docker.sock', function () {
    var modem = new Modem();
    assert.ok(modem.socketPath);
    assert.strictEqual(modem.socketPath, '/var/run/docker.sock');
  });

  it('should allow DOCKER_HOST=unix:///path/to/docker.sock', function () {
    process.env.DOCKER_HOST = 'unix:///tmp/docker.sock';

    var modem = new Modem();
    assert.ok(modem.socketPath);
    assert.strictEqual(modem.socketPath, '/tmp/docker.sock');
  });

  it('should interpret DOCKER_HOST=unix:// as /var/run/docker.sock', function () {
    process.env.DOCKER_HOST = 'unix://';

    var modem = new Modem();
    assert.ok(modem.socketPath);
    assert.strictEqual(modem.socketPath, '/var/run/docker.sock');
  });

  it('should interpret DOCKER_HOST=tcp://N.N.N.N:2376 as https', function () {
    process.env.DOCKER_HOST = 'tcp://192.168.59.103:2376';

    var modem = new Modem();
    assert.ok(modem.host);
    assert.ok(modem.port);
    assert.ok(modem.protocol);
    assert.strictEqual(modem.host, '192.168.59.103');
    assert.strictEqual(modem.port, '2376');
    assert.strictEqual(modem.protocol, 'https');
  });

  it('should interpret DOCKER_HOST=tcp://N.N.N.N:5555 as http', function () {
    process.env.DOCKER_HOST = 'tcp://192.168.59.105:5555';

    var modem = new Modem();
    assert.ok(modem.host);
    assert.ok(modem.port);
    assert.ok(modem.protocol);
    assert.strictEqual(modem.host, '192.168.59.105');
    assert.strictEqual(modem.port, '5555');
    assert.strictEqual(modem.protocol, 'http');
  });
});
