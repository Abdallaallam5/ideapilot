'use strict';

const bcrypt = require('bcrypt');
const User = require('../models/User');
const { loadEnv } = require('../config/env');
const logger = require('../utils/logger');

// Used when the email is unknown so login timing does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('ideapilot-timing-dummy', 10);

function safeReturnTo(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/dashboard';
}

/** Regenerates the session id on login to prevent session fixation. */
function establishSession(req, user) {
  const returnTo = req.session.returnTo;
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = String(user._id);
      req.session.createdAt = Date.now();
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve(safeReturnTo(returnTo))));
    });
  });
}

function showRegister(req, res) {
  res.render('auth/register', { title: 'Create your account', values: {}, errors: {} });
}

function renderRegisterErrors(req, res, errors) {
  const { name, email } = req.body || {};
  res.status(422).render('auth/register', { title: 'Create your account', values: { name, email }, errors });
}

async function register(req, res) {
  const { name, email, password } = req.validated;
  const existing = await User.exists({ email });
  if (existing) return renderRegisterErrors(req, res, { email: 'An account with this email already exists. Try logging in.' });
  let user;
  try {
    const passwordHash = await bcrypt.hash(password, loadEnv().BCRYPT_ROUNDS);
    user = await User.create({ name, email, passwordHash, lastLoginAt: new Date() });
  } catch (err) {
    if (err.code === 11000) return renderRegisterErrors(req, res, { email: 'An account with this email already exists. Try logging in.' });
    throw err;
  }
  logger.info('User registered', { userId: user._id });
  await establishSession(req, user);
  req.flash('success', `Welcome to IdeaPilot, ${user.name}! Start by creating your first idea.`);
  res.redirect('/dashboard');
}

function showLogin(req, res) {
  res.render('auth/login', { title: 'Log in', values: {}, errors: {} });
}

function renderLoginErrors(req, res, errors, status = 422) {
  res.status(status).render('auth/login', { title: 'Log in', values: { email: req.body?.email || '' }, errors });
}

async function login(req, res) {
  const { email, password } = req.validated;
  const user = await User.findOne({ email });
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) {
    logger.info('Failed login attempt');
    return renderLoginErrors(req, res, { _form: 'Incorrect email or password.' }, 401);
  }
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  const target = await establishSession(req, user);
  req.flash('success', `Welcome back, ${user.name}.`);
  res.redirect(target);
}

function logout(req, res, next) {
  const name = loadEnv().SESSION_NAME;
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie(name, { httpOnly: true, sameSite: 'lax', secure: loadEnv().isProduction });
    res.redirect('/');
  });
}

function showSettings(req, res) {
  res.render('auth/settings', { title: 'Account settings', errors: {}, values: { name: req.user.name, defaultTaskView: req.user.settings?.defaultTaskView || 'list' } });
}

async function updateSettings(req, res) {
  const { name, defaultTaskView } = req.validated;
  await User.updateOne({ _id: req.user._id }, { $set: { name, 'settings.defaultTaskView': defaultTaskView } });
  req.flash('success', 'Settings saved.');
  res.redirect('/settings');
}

async function changePassword(req, res) {
  const user = await User.findById(req.user._id);
  const ok = await bcrypt.compare(req.validated.currentPassword, user.passwordHash);
  if (!ok) {
    return res.status(422).render('auth/settings', {
      title: 'Account settings', errors: { currentPassword: 'Your current password is incorrect.' },
      values: { name: user.name, defaultTaskView: user.settings?.defaultTaskView || 'list' },
    });
  }
  user.passwordHash = await bcrypt.hash(req.validated.newPassword, loadEnv().BCRYPT_ROUNDS);
  await user.save();
  await establishSession(req, user);
  req.flash('success', 'Password changed.');
  res.redirect('/settings');
}

module.exports = {
  showRegister, register, renderRegisterErrors, showLogin, login, renderLoginErrors, logout,
  showSettings, updateSettings, changePassword, safeReturnTo,
};
