'use strict';

require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const { expect } = require('./helpers/expect');

const request = require('supertest');
const mongoose = require('mongoose');
const User = require('../models/User');
const { startApp, stopApp, clearDatabase, extractCsrf, registerUser, getApp } = require('./helpers/setup');

before(startApp);
after(stopApp);
beforeEach(clearDatabase);

describe('registration', () => {
  test('creates a user with a bcrypt hash and a normalized email, then signs them in', async () => {
    const agent = request.agent(getApp());
    const csrf = extractCsrf((await agent.get('/register')).text);
    const res = await agent.post('/register').type('form').send({
      _csrf: csrf, name: 'Ada', email: '  Ada@Example.COM ', password: 'secret123', confirmPassword: 'secret123',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');

    const user = await User.findOne({ email: 'ada@example.com' }).lean();
    expect(user).toBeTruthy();
    expect(user.passwordHash).not.toContain('secret123');
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);

    const dash = await agent.get('/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.text).toContain('Hi, Ada');
  });

  test('rejects invalid input with helpful messages and status 422', async () => {
    const agent = request.agent(getApp());
    const csrf = extractCsrf((await agent.get('/register')).text);
    const res = await agent.post('/register').type('form').send({
      _csrf: csrf, name: '', email: 'not-an-email', password: 'short', confirmPassword: 'other',
    });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Name is required.');
    expect(res.text).toContain('Enter a valid email address.');
    expect(res.text).toContain('Password must be at least 8 characters.');
    expect(await User.countDocuments()).toBe(0);
  });

  test('rejects a duplicate email', async () => {
    await registerUser({ email: 'dup@example.com' });
    const agent = request.agent(getApp());
    const csrf = extractCsrf((await agent.get('/register')).text);
    const res = await agent.post('/register').type('form').send({
      _csrf: csrf, name: 'Other', email: 'DUP@example.com', password: 'secret123', confirmPassword: 'secret123',
    });
    expect(res.status).toBe(422);
    expect(res.text).toContain('already exists');
    expect(await User.countDocuments({ email: 'dup@example.com' })).toBe(1);
  });
});

describe('login, logout and sessions', () => {
  test('logs in with correct credentials and rejects wrong ones', async () => {
    await registerUser({ email: 'login@example.com' });
    const agent = request.agent(getApp());
    let csrf = extractCsrf((await agent.get('/login')).text);
    const bad = await agent.post('/login').type('form').send({ _csrf: csrf, email: 'login@example.com', password: 'wrong-pass1' });
    expect(bad.status).toBe(401);
    expect(bad.text).toContain('Incorrect email or password.');

    const unknown = await agent.post('/login').type('form').send({ _csrf: csrf, email: 'nobody@example.com', password: 'secret123' });
    expect(unknown.status).toBe(401);

    csrf = extractCsrf((await agent.get('/login')).text);
    const ok = await agent.post('/login').type('form').send({ _csrf: csrf, email: 'LOGIN@example.com', password: 'secret123' });
    expect(ok.status).toBe(302);
    expect(ok.headers.location).toBe('/dashboard');
  });

  test('stores sessions in MongoDB with secure cookie flags and keeps the user signed in', async () => {
    const agent = request.agent(getApp());
    const csrf = extractCsrf((await agent.get('/register')).text);
    const res = await agent.post('/register').type('form').send({
      _csrf: csrf, name: 'Sam', email: 'sam@example.com', password: 'secret123', confirmPassword: 'secret123',
    });
    const cookie = res.headers['set-cookie'].join(';');
    expect(cookie).toContain('ideapilot.sid=');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Expires=/i);

    const sessions = await mongoose.connection.db.collection('sessions').find({}).toArray();
    const user = await User.findOne({ email: 'sam@example.com' });
    expect(sessions.some((s) => String(s.session.userId) === String(user._id))).toBe(true);

    // Several requests later the same cookie is still a valid session.
    for (let i = 0; i < 3; i++) expect((await agent.get('/dashboard')).status).toBe(200);
  });

  test('regenerates the session id on login (session fixation protection)', async () => {
    await registerUser({ email: 'fix@example.com' });
    const agent = request.agent(getApp());
    const page = await agent.get('/login');
    const before = page.headers['set-cookie'].join(';').match(/ideapilot\.sid=([^;]+)/)[1];
    const res = await agent.post('/login').type('form').send({ _csrf: extractCsrf(page.text), email: 'fix@example.com', password: 'secret123' });
    const after = res.headers['set-cookie'].join(';').match(/ideapilot\.sid=([^;]+)/)[1];
    expect(after).not.toBe(before);
  });

  test('logout destroys the session', async () => {
    const { agent, csrf } = await registerUser();
    const res = await agent.post('/logout').type('form').send({ _csrf: csrf });
    expect(res.status).toBe(302);
    const dash = await agent.get('/dashboard');
    expect(dash.status).toBe(302);
    expect(dash.headers.location).toBe('/login');
  });
});

describe('protected routes and CSRF', () => {
  test('anonymous visitors are redirected to login, JSON clients get 401', async () => {
    const res = await request(getApp()).get('/dashboard');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
    const page = await request(getApp()).get('/projects/new');
    expect(page.status).toBe(302);
    const json = await request(getApp()).get(`/projects/${new mongoose.Types.ObjectId()}/graph`).set('Accept', 'application/json');
    expect(json.status).toBe(401);
  });

  test('state-changing requests without a valid CSRF token are rejected', async () => {
    const { agent } = await registerUser();
    const res = await agent.post('/projects').type('form').send({ title: 'x', description: 'y' });
    expect(res.status).toBe(403);
    const bad = await agent.post('/projects').type('form').send({ _csrf: 'f'.repeat(64), title: 'x', description: 'y' });
    expect(bad.status).toBe(403);
  });

  test('settings can be updated and the password changed', async () => {
    const { agent, csrf, user } = await registerUser();
    const wrong = await agent.post('/settings/password').type('form').send({ _csrf: csrf, currentPassword: 'nope', newPassword: 'newpass123', confirmPassword: 'newpass123' });
    expect(wrong.status).toBe(422);
    const ok = await agent.post('/settings/password').type('form').send({ _csrf: csrf, currentPassword: user.password, newPassword: 'newpass123', confirmPassword: 'newpass123' });
    expect(ok.status).toBe(302);
    const fresh = request.agent(getApp());
    const page = await fresh.get('/login');
    const login = await fresh.post('/login').type('form').send({ _csrf: extractCsrf(page.text), email: user.email, password: 'newpass123' });
    expect(login.status).toBe(302);
  });
});
