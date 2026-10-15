'use strict';

const User = require('../models/User');
const { wantsJson } = require('../utils/http');

/** Loads the signed-in user (if any) into req.user and res.locals.currentUser. */
async function loadCurrentUser(req, res, next) {
  res.locals.currentUser = null;
  const userId = req.session && req.session.userId;
  if (!userId) return next();
  const user = await User.findById(userId).lean();
  if (!user) {
    delete req.session.userId;
    return next();
  }
  req.user = user;
  res.locals.currentUser = { id: String(user._id), name: user.name, email: user.email, settings: user.settings || {} };
  return next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  if (req.method === 'GET' && req.session) req.session.returnTo = req.originalUrl;
  req.flash && req.flash('warning', 'Please log in to continue.');
  return res.redirect('/login');
}

function requireGuest(req, res, next) {
  if (req.user) return res.redirect('/dashboard');
  return next();
}

module.exports = { loadCurrentUser, requireAuth, requireGuest };
