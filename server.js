require('dotenv').config();

const express = require('express');
const requestId = require('./utils/requestId');
const requestLogger = require('./middleware/requestLogger');
const logger = require('./middleware/logger');
const paths = require('./utils/paths');
const productRoutes = require('./routes/productRoutes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(requestId);
app.use(requestLogger());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'nodejs-advanced-features-4',
    description: 'Express 5 logging API with morgan and winston',
    status: 'ok',
    endpoints: {
      health: 'GET /health',
      listProducts: 'GET /api/products',
      getProduct: 'GET /api/products/:id',
      createProduct: 'POST /api/products',
      logDemo: 'GET /api/logs/demo',
      logSummary: 'GET /api/logs/summary',
    },
    docs: 'https://github.com/reshma0325-source/nodejs-advanced-features-4#readme',
  });
});

app.use('/api', productRoutes);

app.use(notFound);
app.use(errorHandler);

const port = Number(process.env.PORT) || 3013;
const host = '0.0.0.0';

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  logger.end(() => process.exit(1));
  setTimeout(() => process.exit(1), 2000);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', {
    reason: reason && reason.stack ? reason.stack : String(reason),
  });
  logger.end(() => process.exit(1));
  setTimeout(() => process.exit(1), 2000);
});

async function startServer() {
  try {
    const server = app.listen(port, host);

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error('Port already in use', { port, code: err.code });
      } else {
        logger.error('Server error', { error: err.message, stack: err.stack });
      }
      logger.end(() => process.exit(1));
    });

    server.on('listening', () => {
      logger.info('Server started', {
        port,
        host,
        nodeEnv: process.env.NODE_ENV || 'development',
        logLevel: process.env.LOG_LEVEL || 'info',
        logsDir: paths.logsDir,
        accessLog: paths.accessLogFile,
        appLog: paths.appLogFile,
        errorLog: paths.errorLogFile,
      });
    });

    const shutdown = (signal) => {
      logger.info('Shutting down', { signal });
      server.close(() => {
        logger.info('HTTP server closed; flushing winston file buffers');
        logger.end(() => process.exit(0));
      });
      setTimeout(() => process.exit(1), 5000).unref();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    return server;
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      logger.error('Port already in use', { port, code: err.code });
    } else {
      logger.error('Failed to start server', { error: err.message, stack: err.stack });
    }
    process.exit(1);
  }
}

startServer();