'use strict';

const crypto = require('crypto');
const { HttpError } = require('../utils/httpError');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function issueToken(req) {
  if (!req.session) throw new Error('Session middleware must run before CSRF protection');
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Synchronizer-token CSRF protection bound to the server-side session.
 * Forms send `_csrf`; fetch() calls send the `X-CSRF-Token` header.
 * The token is created lazily (views call csrfToken()) so anonymous visitors
 * to pages without forms do not get a session.
 */
function csrfProtection(req, res, next) {
  res.locals.csrfToken = () => issueToken(req);
  req.csrfToken = () => issueToken(req);

  if (SAFE_METHODS.has(req.method)) return next();

  const expected = req.session && req.session.csrfToken;
  const provided = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (!expected || !tokensMatch(String(provided || ''), expected)) {
    return next(new HttpError(403, 'Your session form token is invalid or expired. Please reload the page and try again.'));
  }
  if (req.body && '_csrf' in req.body) delete req.body._csrf;
  return next();
}

module.exports = { csrfProtection, issueToken };
