'use strict';

const mongoose = require('mongoose');
const logger = require('../utils/logger');

// Query-selector injection (e.g. { email: { $gt: '' } }) is prevented upstream: every
// request body, query and param is parsed by a Zod schema into plain strings, numbers
// and ObjectIds before it reaches a query. strictQuery drops unknown filter paths.
mongoose.set('strictQuery', true);

let listenersAttached = false;

function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (err) => logger.error('MongoDB error', { error: err }));
}

/**
 * Connects to MongoDB, retrying a few times so a slow-starting database
 * does not crash the process on boot.
 */
async function connectDatabase(uri, { retries = 5, delayMs = 2000 } = {}) {
  attachListeners();
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 20 });
      return mongoose.connection;
    } catch (err) {
      if (attempt >= retries) throw err;
      logger.warn('MongoDB connection failed, retrying', { attempt, retries, error: err });
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}

module.exports = { connectDatabase, disconnectDatabase, isDatabaseReady };
