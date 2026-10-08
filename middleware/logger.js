const winston = require('winston');
const { logsDir } = require('../utils/paths');

const level = process.env.LOG_LEVEL || 'info';

const consoleFormat =
  process.env.NODE_ENV === 'production'
    ? winston.format.simple()
    : winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.simple()
      );

const logger = winston.createLogger({
  level,
  exitOnError: false,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.File({
      dirname: logsDir,
      filename: 'app.log',
      level: 'info',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
    new winston.transports.File({
      dirname: logsDir,
      filename: 'error.log',
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
  ],
});

logger.request = function request(meta) {
  return logger.info('Incoming request', meta);
};

module.exports = logger;
module.exports.logger = logger;