'use strict';

const { loadEnv } = require('./config/env');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const logger = require('./utils/logger');

async function main() {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    // Print the list of missing/invalid variable names only, never values.
    process.stderr.write(`${err.message}\n\nCopy .env.example to .env and fill in the required values.\n`);
    process.exit(1);
  }

  try {
    await connectDatabase(env.MONGODB_URI);
  } catch (err) {
    logger.error('Could not connect to MongoDB. Check MONGODB_URI and that the database is running.', { error: err });
    process.exit(1);
  }

  const { createApp } = require('./app');
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`IdeaPilot listening on ${env.APP_BASE_URL}`, { port: env.PORT, env: env.NODE_ENV, ai: Boolean(env.AI_API_KEY) });
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });
    server.close(async () => {
      await disconnectDatabase().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error('Unhandled promise rejection', { error: reason }));
}

main();
