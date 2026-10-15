'use strict';

require('./helpers/env');
const { describe, test, before, after } = require('node:test');
const { expect } = require('./helpers/expect');
const request = require('supertest');
const { loadEnv, resetEnvCache } = require('../config/env');
const { startApp, stopApp, registerUser, createProject, getApp } = require('./helpers/setup');

before(startApp);
after(stopApp);

describe('pages and infrastructure', () => {
  test('landing page renders the marketing site with security headers', async () => {
    const res = await request(getApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Turn Your Ideas Into Action.');
    expect(res.text).toContain('id="faq"');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBe(undefined);
    // Anonymous page views do not create sessions.
    expect(res.headers['set-cookie']).toBe(undefined);
  });

  test('health check reports the database state', async () => {
    const res = await request(getApp()).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.database).toBe('connected');
  });

  test('unknown routes render a 404 page', async () => {
    const res = await request(getApp()).get('/nope');
    expect(res.status).toBe(404);
    expect(res.text).toContain('Page not found');
  });

  test('oversized and malformed JSON bodies are rejected safely', async () => {
    const ctx = await registerUser();
    const id = await createProject(ctx);
    const big = await ctx.agent.post(`/projects/${id}/graph/nodes`).set('Content-Type', 'application/json').set('X-CSRF-Token', ctx.csrf)
      .send(JSON.stringify({ type: 'note', title: 'x', description: 'a'.repeat(300 * 1024) }));
    expect(big.status).toBe(413);
    const bad = await ctx.agent.post(`/projects/${id}/graph/nodes`).set('Content-Type', 'application/json').set('X-CSRF-Token', ctx.csrf).send('{"type":');
    expect(bad.status).toBe(400);
  });

  test('query operator injection in login is rejected by validation', async () => {
    const agent = request.agent(getApp());
    const page = await agent.get('/login');
    const csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(page.text)[1];
    const res = await agent.post('/login').set('Content-Type', 'application/json').send({ _csrf: csrf, email: { $gt: '' }, password: 'x' });
    expect(res.status).toBe(422);
  });
});

describe('environment validation', () => {
  test('reports missing variables by name without values', () => {
    const saved = { ...process.env };
    try {
      delete process.env.MONGODB_URI;
      process.env.SESSION_SECRET = 'short';
      resetEnvCache();
      let error;
      try { loadEnv(); } catch (e) { error = e; }
      expect(error.code).toBe('ENV_INVALID');
      expect(error.message).toContain('MONGODB_URI');
      expect(error.message).toContain('SESSION_SECRET');
      expect(error.message).not.toContain('short');
    } finally {
      Object.assign(process.env, saved);
      resetEnvCache();
    }
  });
});

describe('login rate limiting', () => {
  test('blocks repeated failed logins', async () => {
    const previous = process.env.LOGIN_RATE_LIMIT;
    process.env.LOGIN_RATE_LIMIT = '3';
    resetEnvCache();
    const { createApp } = require('../app');
    const limited = createApp();
    process.env.LOGIN_RATE_LIMIT = previous;
    resetEnvCache();

    const agent = request.agent(limited);
    const page = await agent.get('/login');
    const csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(page.text)[1];
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      const res = await agent.post('/login').type('form').send({ _csrf: csrf, email: 'victim@example.com', password: `guess${i}aa` });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses[3]).toBe(303);
    expect(statuses[4]).toBe(303);
    const after = await agent.get('/login');
    expect(after.text).toContain('Too many attempts');
  });
});

describe('language toggle', () => {
  test('switches to Arabic with RTL and back to English', async () => {
    const res = await request(getApp()).get('/lang/ar?next=/login');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/login');
    const cookie = res.headers['set-cookie'].join(';');
    expect(cookie).toContain('ideapilot.lang=ar');
    expect(cookie).toContain('HttpOnly');

    const page = await request(getApp()).get('/login').set('Cookie', 'ideapilot.lang=ar');
    expect(page.text).toContain('lang="ar" dir="rtl"');
    expect(page.text).toContain('bootstrap.rtl.min.css');

    const en = await request(getApp()).get('/login').set('Cookie', 'ideapilot.lang=en');
    expect(en.text).toContain('lang="en" dir="ltr"');
  });

  test('uses Accept-Language when no cookie is set', async () => {
    const page = await request(getApp()).get('/login').set('Accept-Language', 'ar-EG,ar;q=0.9');
    expect(page.text).toContain('dir="rtl"');
  });

  test('refuses to redirect off-site and ignores unknown languages', async () => {
    for (const next of ['https://evil.example', '//evil.example', '/\\evil.example']) {
      const res = await request(getApp()).get('/lang/ar').query({ next });
      expect(res.status).toBe(303);
      expect(res.headers.location).toBe('/');
    }
    const bad = await request(getApp()).get('/lang/xx?next=/login');
    expect((bad.headers['set-cookie'] || []).join(';')).not.toContain('ideapilot.lang=xx');
  });
});
