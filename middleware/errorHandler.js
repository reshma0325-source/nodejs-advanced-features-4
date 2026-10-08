const logger = require('./logger');

module.exports = function errorHandler(err, req, res, next) {
  const statusCode = err.status || err.statusCode || 500;
  const message =
    statusCode >= 500 ? 'Internal server error' : err.message || 'Request failed';

  logger.error(`Error: ${message}`, {
    method: req.method,
    url: req.originalUrl,
    statusCode,
    requestId: req.id,
    stack: err.stack,
  });

  if (res.headersSent) {
    return next(err);
  }

  res.status(statusCode).json({ status: 'error', message });
};