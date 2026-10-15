'use strict';

/**
 * Vercel entry point. Vercel runs this file as a serverless function instead of
 * server.js: there is no long-running process, so the MongoDB connection and the
 * Express app are created on the first request and reused while the instance is warm.
 */
const { loadEnv } = require('../config/env');
const { connectDatabase } = require('../config/database');
const logger = require('../utils/logger');

let ready = null;

function init() {
  if (!ready) {
    ready = (async () => {
      const env = loadEnv();
      await connectDatabase(env.MONGODB_URI, { retries: 2, delayMs: 1000 });
      const { createApp } = require('../app');
      return createApp();
    })().catch((err) => {
      ready = null; // let the next request try again
      throw err;
    });
  }
  return ready;
}

module.exports = async (req, res) => {
  let app;
  try {
    app = await init();
  } catch (err) {
    // Environment errors list variable names only, never values.
    logger.error('IdeaPilot failed to start', { error: err });
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('IdeaPilot could not start. Check the environment variables and the MongoDB connection in the Vercel logs.');
    return;
  }
  return app(req, res);
};
