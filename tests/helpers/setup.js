'use strict';

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;
let app;

/** Starts a real (in-memory) MongoDB and builds the Express app against it. */
async function startApp() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('ideapilot-test'));
  const { createApp } = require('../../app');
  app = createApp();
  return app;
}

async function stopApp() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

async function clearDatabase() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

function extractCsrf(html) {
  const m = /name="_csrf" value="([a-f0-9]+)"/.exec(html) || /<meta name="csrf-token" content="([a-f0-9]+)"/.exec(html);
  return m ? m[1] : null;
}

/** A logged-in supertest agent with its CSRF token. */
async function registerUser(overrides = {}) {
  const agent = request.agent(app);
  const page = await agent.get('/register');
  const user = {
    name: 'Test User',
    email: `user${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`,
    password: 'secret123',
    confirmPassword: 'secret123',
    ...overrides,
  };
  const res = await agent.post('/register').type('form').send({ _csrf: extractCsrf(page.text), ...user });
  if (res.status !== 302) throw new Error(`Registration failed with ${res.status}: ${res.text.slice(0, 300)}`);
  const dash = await agent.get('/dashboard');
  const csrf = extractCsrf(dash.text);
  return { agent, csrf, user };
}

async function createProject(ctx, data = {}) {
  const res = await ctx.agent.post('/projects').type('form').send({
    _csrf: ctx.csrf, title: 'Community garden', description: 'Turn an empty lot into a shared garden.', ...data,
  });
  if (res.status !== 302) throw new Error(`Project creation failed with ${res.status}`);
  const id = /\/projects\/([a-f0-9]{24})\/map/.exec(res.headers.location)[1];
  return id;
}

/** JSON request helper with CSRF header. */
function api(ctx, method, url, body) {
  const req = ctx.agent[method](url).set('Accept', 'application/json').set('X-CSRF-Token', ctx.csrf);
  return body === undefined ? req : req.send(body);
}

module.exports = { startApp, stopApp, clearDatabase, extractCsrf, registerUser, createProject, api, getApp: () => app };
