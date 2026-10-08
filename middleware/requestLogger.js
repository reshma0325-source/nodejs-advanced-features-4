const fs = require('fs');
const morgan = require('morgan');
const { accessLogFile } = require('../utils/paths');

const isProduction = process.env.NODE_ENV === 'production';

morgan.token('request-id', (req) => req.id || req.headers['x-request-id'] || '-');
morgan.token('user-agent-short', (req) => {
  const ua = req.headers['user-agent'] || '';
  return ua.length > 40 ? ua.slice(0, 40) : ua;
});

morgan.format(
  'combined-trace',
  ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :request-id'
);

function requestLogger() {
  const accessStream = fs.createWriteStream(accessLogFile, { flags: 'a' });
  accessStream.on('error', (err) => {
    console.warn(`Access log stream disabled (${err.message}); continuing with console output only.`);
  });

  return function loggerMiddleware(req, res, next) {
    let called = false;
    const done = (err) => {
      if (called) return;
      called = true;
      next(err);
    };

    if (isProduction) {
      morgan('combined-trace', { stream: accessStream })(req, res, done);
      return;
    }

    morgan('dev')(req, res, done);
    morgan('short', { stream: accessStream })(req, res, done);
  };
}

module.exports = requestLogger;