'use strict';

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { wantsJson } = require('../utils/http');

function handler(message) {
  return (req, res) => {
    if (wantsJson(req)) return res.status(429).json({ error: message });
    req.flash('danger', message);
    // Browsers cannot follow a redirect with status 429, so form posts get a 303 + flash message.
    return res.redirect(303, req.get('referer') || req.path || '/');
  };
}

/** Limits login/registration attempts per IP + email to slow credential stuffing. */
function createAuthLimiter(env) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.LOGIN_RATE_LIMIT,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip || '')}:${String(req.body?.email || '').toLowerCase().slice(0, 200)}`,
    handler: handler('Too many attempts. Please wait a few minutes and try again.'),
  });
}

/** Per-user burst limit for AI endpoints (daily quota is enforced in aiService). */
function createAILimiter(env) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: env.AI_RATE_LIMIT_PER_MINUTE,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => (req.user ? `user:${req.user._id}` : ipKeyGenerator(req.ip || '')),
    handler: handler('You are sending requests to the IdeaPilot assistant too quickly. Please wait a minute.'),
  });
}

module.exports = { createAuthLimiter, createAILimiter };
