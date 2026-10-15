'use strict';

const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const helmet = require('helmet');
const cors = require('cors');

const { loadEnv } = require('./config/env');
const { createSessionMiddleware } = require('./config/session');
const { isDatabaseReady } = require('./config/database');
const aiConfig = require('./config/ai');
const logger = require('./utils/logger');
const format = require('./utils/format');
const { i18n } = require('./middleware/i18n');
const { SUPPORTED, LANG_COOKIE } = require('./utils/i18n');
const { safeJson, escapeHtml } = require('./utils/http');
const { csrfProtection } = require('./middleware/csrfProtection');
const { flash } = require('./middleware/flash');
const { loadCurrentUser } = require('./middleware/requireAuth');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const constants = require('./models/constants');

/**
 * Builds the Express application. The database connection is owned by
 * server.js (or the test harness) so the app itself stays easy to test.
 */
function createApp(options = {}) {
  const env = loadEnv();
  const app = express();

  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('layout', 'layouts/main');
  app.use(expressLayouts);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'form-action': ["'self'"],
          'upgrade-insecure-requests': env.isProduction ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  // Explicit CORS policy: only the app's own origin may make credentialed cross-origin calls.
  const allowedOrigin = new URL(env.APP_BASE_URL).origin;
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || origin === allowedOrigin ? origin || false : false),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    })
  );

  app.use(express.json({ limit: '200kb' }));
  app.use(express.urlencoded({ extended: false, limit: '200kb', parameterLimit: 1000 }));

  const staticOpts = { maxAge: env.isProduction ? '7d' : 0, index: false };
  app.use('/static', express.static(path.join(__dirname, 'public'), staticOpts));
  // Browser libraries are copied into public/vendor by `npm run vendor`.
  app.use('/vendor', express.static(path.join(__dirname, 'public', 'vendor'), staticOpts));
  app.get('/favicon.ico', (req, res) => res.redirect(301, '/static/images/logo.svg'));

  app.get('/healthz', (req, res) => {
    const ok = isDatabaseReady();
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', database: ok ? 'connected' : 'unavailable' });
  });

  // Structured request log (no bodies, no query strings, no cookies).
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info('request', { method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms), userId: req.user?._id });
    });
    next();
  });

  // View defaults (set before session so error pages can always render).
  app.use((req, res, next) => {
    res.locals.title = 'IdeaPilot';
    res.locals.currentUser = null;
    res.locals.consumeFlash = () => [];
    res.locals.csrfToken = () => '';
    res.locals.path = req.path;
    res.locals.fmt = format;
    res.locals.safeJson = safeJson;
    res.locals.escapeHtml = escapeHtml;
    res.locals.C = constants;
    res.locals.ai = aiConfig.publicInfo();
    res.locals.bodyClass = '';
    res.locals.pageScripts = [];
    res.locals.pageStyles = [];
    next();
  });
  app.use(i18n);

  // Language switch: remembers the choice in a cookie and returns to a local page.
  app.get('/lang/:code', (req, res) => {
    const code = SUPPORTED.includes(req.params.code) ? req.params.code : 'en';
    const nextUrl = typeof req.query.next === 'string' && /^\/(?![\/\\])/.test(req.query.next) ? req.query.next : '/';
    res.cookie(LANG_COOKIE, code, { maxAge: 365 * 24 * 3600 * 1000, sameSite: 'lax', httpOnly: true, secure: env.isProduction });
    res.redirect(303, nextUrl);
  });

  app.use(createSessionMiddleware(env, { store: options.sessionStore }));
  app.use(flash);
  app.use(csrfProtection);
  app.use(loadCurrentUser);


  app.use(require('./routes/pageRoutes'));
  app.use(require('./routes/authRoutes')(env));
  app.use(require('./routes/dashboardRoutes'));
  app.use(require('./routes/projectRoutes'));
  app.use(require('./routes/graphRoutes'));
  app.use(require('./routes/planRoutes'));
  app.use(require('./routes/taskRoutes'));
  app.use(require('./routes/historyRoutes'));
  app.use(require('./routes/aiRoutes')(env));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

/**
 * Hosts that look for an Express app in app.js (such as Vercel's Express preset) need a
 * function as the default export. It hands the request to the serverless entry in
 * api/index.js, which connects to MongoDB once and builds the app. server.js and the
 * tests keep using createApp.
 */
function handler(req, res) {
  return require('./api/index')(req, res);
}
handler.createApp = createApp;

module.exports = handler;
