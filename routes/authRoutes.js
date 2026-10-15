'use strict';

const express = require('express');
const auth = require('../controllers/authController');
const { requireAuth, requireGuest } = require('../middleware/requireAuth');
const { validateRequest } = require('../middleware/validateRequest');
const { createAuthLimiter } = require('../middleware/rateLimiter');
const { registerSchema, loginSchema, settingsSchema, passwordSchema } = require('../validators/authValidators');

module.exports = function authRoutes(env) {
  const router = express.Router();
  const limiter = createAuthLimiter(env);

  router.get('/register', requireGuest, auth.showRegister);
  router.post('/register', requireGuest, limiter, validateRequest(registerSchema, { onError: auth.renderRegisterErrors }), auth.register);
  router.get('/login', requireGuest, auth.showLogin);
  router.post('/login', requireGuest, limiter, validateRequest(loginSchema, { onError: auth.renderLoginErrors }), auth.login);
  router.post('/logout', auth.logout);

  const settingsError = (req, res, errors) =>
    res.status(422).render('auth/settings', { title: 'Account settings', errors, values: { name: req.body.name, defaultTaskView: req.body.defaultTaskView } });
  router.get('/settings', requireAuth, auth.showSettings);
  router.post('/settings', requireAuth, validateRequest(settingsSchema, { onError: settingsError }), auth.updateSettings);
  router.post('/settings/password', requireAuth, limiter, validateRequest(passwordSchema, {
    onError: (req, res, errors) => res.status(422).render('auth/settings', { title: 'Account settings', errors, values: { name: req.user.name, defaultTaskView: req.user.settings?.defaultTaskView || 'list' } }),
  }), auth.changePassword);
  return router;
};
