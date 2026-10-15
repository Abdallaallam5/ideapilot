'use strict';

const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const mongoose = require('mongoose');

/**
 * Builds the session middleware. Sessions live in MongoDB (collection "sessions")
 * and expire after SESSION_MAX_AGE_HOURS of inactivity (rolling expiry).
 */
function createSessionMiddleware(env, { store } = {}) {
  const maxAgeMs = env.SESSION_MAX_AGE_HOURS * 60 * 60 * 1000;
  const sessionStore =
    store ||
    MongoStore.create({
      client: mongoose.connection.getClient(),
      collectionName: 'sessions',
      ttl: Math.round(maxAgeMs / 1000),
      autoRemove: 'native',
      touchAfter: 60,
      stringify: false,
    });

  return session({
    name: env.SESSION_NAME,
    secret: env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: env.TRUST_PROXY,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.isProduction,
      maxAge: maxAgeMs,
    },
  });
}

module.exports = { createSessionMiddleware };
