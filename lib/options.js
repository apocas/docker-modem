/**
This module parses the modem options from a string if needed.

Given an object his module will return that object.

Given a string the module will parse it and return the correct internal
options as an object.

$PORT:HOST string

```js
parse('127.0.0.1:4243');
// => { host: '127.0.0.1', port: 4243 }

parse('/magic/path');
// => { socketPath: '/magic/path' }
```

@param {String|Object} options for connection.
@return {Object} proper options for modem.
*/
function parse(options) {
  // XXX: should we validate?
  if (typeof options !== 'string') return options;

  // if it starts with a slash its a path
  if (options[0] === '/') return { socketPath: options };

  // options may contain a protocol part we don't care about it so trim it if
  // its present.
  options = options.split('://').pop();

  // finally parse out the host:path
  var parts = options.split(':');
  return {
    host: parts[0],
    port: parseInt(parts[1], 10)
  };
}

module.exports = parse;
