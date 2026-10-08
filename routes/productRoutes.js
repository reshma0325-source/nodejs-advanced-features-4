const fs = require('fs');
const express = require('express');
const logger = require('../middleware/logger');
const paths = require('../utils/paths');

const router = express.Router();

const products = [
  { id: 1, name: 'Laptop', price: 999.99 },
  { id: 2, name: 'Wireless Mouse', price: 19.99 },
  { id: 3, name: 'Mechanical Keyboard', price: 89.99 },
  { id: 4, name: '27in Monitor', price: 219.99 },
  { id: 5, name: 'Webcam', price: 59.99 },
  { id: 6, name: 'Headset', price: 79.99 },
];

router.get('/products', (req, res) => {
  logger.info('Listing products', { count: products.length, query: req.query });
  res.json({ status: 'ok', count: products.length, data: products });
});

router.post('/products', (req, res) => {
  const { name, price } = req.body || {};

  if (typeof name !== 'string' || name.trim() === '') {
    logger.warn('Product validation failed', {
      reason: 'name must be a non-empty string',
      name,
      price,
      url: req.originalUrl,
    });
    return res.status(400).json({
      status: 'error',
      message: 'name must be a non-empty string',
    });
  }

  if (typeof price !== 'number' || Number.isNaN(price) || price < 0) {
    logger.warn('Product validation failed', {
      reason: 'price must be a number >= 0',
      name,
      price,
      url: req.originalUrl,
    });
    return res.status(400).json({
      status: 'error',
      message: 'price must be a number >= 0',
    });
  }

  const product = { id: products.length + 1, name: name.trim(), price };
  products.push(product);

  logger.info('Product created', {
    id: product.id,
    name: product.name,
    price: product.price,
    requestId: req.id,
  });

  res.status(201).json({ status: 'ok', data: product });
});

router.get('/products/:id', (req, res) => {
  const id = Number(req.params.id);
  const product = products.find((p) => p.id === id);

  if (!product) {
    logger.warn('Product not found', {
      id: req.params.id,
      url: req.originalUrl,
      requestId: req.id,
    });
    return res.status(404).json({
      status: 'error',
      message: `Product with id ${req.params.id} not found`,
    });
  }

  logger.info('Product found', {
    id,
    name: product.name,
    price: product.price,
    url: req.originalUrl,
    requestId: req.id,
  });

  res.json({ status: 'ok', data: product });
});

router.get('/logs/demo', (req, res) => {
  logger.debug('Demo debug message', { route: '/api/logs/demo', requestId: req.id });
  logger.info('Demo info message', { route: '/api/logs/demo', requestId: req.id });
  logger.warn('Demo warn message', { route: '/api/logs/demo', requestId: req.id });
  logger.error('Demo error message', {
    route: '/api/logs/demo',
    requestId: req.id,
    stack: new Error('demo error').stack,
  });

  res.json({
    message: 'Wrote one entry at each level. Check logs/app.log and logs/error.log.',
  });
});

router.get('/logs/summary', (req, res) => {
  const result = {};

  for (const [key, file] of [
    ['app', paths.appLogFile],
    ['access', paths.accessLogFile],
    ['error', paths.errorLogFile],
  ]) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);
      result[key] = lines.slice(-20);
    } catch (err) {
      result[key] = { readError: err.message };
    }
  }

  res.json({ status: 'ok', logLines: result });
});

module.exports = router;