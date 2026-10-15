'use strict';

/**
 * Starts IdeaPilot against a throwaway in-memory MongoDB (via mongodb-memory-server).
 * Handy for trying the app without installing MongoDB. Data is lost on exit.
 *   npm run dev:memory
 */
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');

(async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('ideapilot');
  if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  process.stdout.write(`In-memory MongoDB started at ${process.env.MONGODB_URI} (data is discarded on exit)\n`);
  const stop = async () => { await mongod.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  require('../server');
})().catch((err) => {
  process.stderr.write(`Could not start in-memory MongoDB: ${err.message}\n`);
  process.exit(1);
});
