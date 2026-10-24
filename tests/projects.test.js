'use strict';

require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const { expect } = require('./helpers/expect');
const Project = require('../models/Project');
const Plan = require('../models/Plan');
const IdeaNode = require('../models/IdeaNode');
const Task = require('../models/Task');
const Activity = require('../models/Activity');
const { startApp, stopApp, clearDatabase, registerUser, createProject, api } = require('./helpers/setup');

before(startApp);
after(stopApp);
beforeEach(clearDatabase);

describe('project CRUD', () => {
  test('creates a project with an initial plan, a root idea node and an activity record', async () => {
    const ctx = await registerUser();
    const res = await ctx.agent.post('/projects').type('form').send({
      _csrf: ctx.csrf, title: '  Neighborhood book swap ', description: 'Share books with neighbors.', budget: 'Under $100',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/projects\/[a-f0-9]{24}\/map$/);
    const project = await Project.findOne().lean();
    expect(project.title).toBe('Neighborhood book swap');
    expect(project.budget).toBe('Under $100');
    const plan = await Plan.findById(project.currentPlan).lean();
    expect(plan.version).toBe(1);
    expect(await IdeaNode.countDocuments({ project: project._id, type: 'idea' })).toBe(1);
    expect(await Activity.countDocuments({ project: project._id, type: 'project_created' })).toBe(1);
  });

  test('requires title and description', async () => {
    const ctx = await registerUser();
    const res = await ctx.agent.post('/projects').type('form').send({ _csrf: ctx.csrf, title: '', description: '' });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Title is required.');
    expect(res.text).toContain('Description is required.');
    expect(await Project.countDocuments()).toBe(0);
  });

  test('dashboard lists real projects with search and filters', async () => {
    const ctx = await registerUser();
    await createProject(ctx, { title: 'Garden plan' });
    await createProject(ctx, { title: 'Learn Spanish', description: 'Reach B1 level.' });
    const all = await ctx.agent.get('/dashboard');
    expect(all.text).toContain('Garden plan');
    expect(all.text).toContain('Learn Spanish');
    const search = await ctx.agent.get('/dashboard?q=spanish');
    expect(search.text).toContain('Learn Spanish');
    expect(search.text).not.toContain('Garden plan');
    const empty = await ctx.agent.get('/dashboard?stage=done');
    expect(empty.text).toContain('No ideas match these filters');
  });

  test('updates via form and via JSON (inline workspace edit)', async () => {
    const ctx = await registerUser();
    const id = await createProject(ctx);
    const form = await ctx.agent.post(`/projects/${id}/update`).type('form').send({
      _csrf: ctx.csrf, title: 'Renamed', description: 'New description', stage: 'planning', status: 'on_hold',
    });
    expect(form.status).toBe(302);
    let p = await Project.findById(id).lean();
    expect(p.title).toBe('Renamed');
    expect(p.stage).toBe('planning');

    const json = await api(ctx, 'post', `/projects/${id}/update`, { title: 'Inline title' });
    expect(json.status).toBe(200);
    expect(json.body.project.title).toBe('Inline title');

    const invalid = await api(ctx, 'post', `/projects/${id}/update`, { stage: 'flying' });
    expect(invalid.status).toBe(422);
    p = await Project.findById(id).lean();
    expect(p.stage).toBe('planning');
  });

  test('deleting a project removes its nodes, plans and tasks', async () => {
    const ctx = await registerUser();
    const id = await createProject(ctx);
    await ctx.agent.post(`/projects/${id}/tasks`).type('form').send({ _csrf: ctx.csrf, title: 'A task' });
    expect(await Task.countDocuments({ project: id })).toBe(1);
    const res = await ctx.agent.post(`/projects/${id}/delete`).type('form').send({ _csrf: ctx.csrf });
    expect(res.status).toBe(302);
    expect(await Project.countDocuments({ _id: id })).toBe(0);
    expect(await IdeaNode.countDocuments({ project: id })).toBe(0);
    expect(await Plan.countDocuments({ project: id })).toBe(0);
    expect(await Task.countDocuments({ project: id })).toBe(0);
  });
});

describe('project ownership', () => {
  test('another user cannot read, change or delete the project', async () => {
    const owner = await registerUser();
    const intruder = await registerUser();
    const id = await createProject(owner);

    for (const path of ['map', 'analysis', 'roadmap', 'tasks', 'review', 'edit']) {
      const res = await intruder.agent.get(`/projects/${id}/${path}`);
      expect(res.status).toBe(404);
    }
    const update = await intruder.agent.post(`/projects/${id}/update`).type('form').send({ _csrf: intruder.csrf, title: 'Hacked' });
    expect(update.status).toBe(404);
    const del = await intruder.agent.post(`/projects/${id}/delete`).type('form').send({ _csrf: intruder.csrf });
    expect(del.status).toBe(404);
    const graph = await api(intruder, 'get', `/projects/${id}/graph`);
    expect(graph.status).toBe(404);
    const node = await api(intruder, 'post', `/projects/${id}/graph/nodes`, { type: 'goal', title: 'x' });
    expect(node.status).toBe(404);

    const p = await Project.findById(id).lean();
    expect(p.title).toBe('Community garden');
    const dash = await intruder.agent.get('/dashboard');
    expect(dash.text).not.toContain('Community garden');
  });

  test('malformed ids return 404 instead of crashing', async () => {
    const ctx = await registerUser();
    const res = await ctx.agent.get('/projects/not-an-id/map');
    expect(res.status).toBe(404);
  });
});

describe('analysis', () => {
  test('saves analysis lists from textareas and fills in items from the map automatically', async () => {
    const ctx = await registerUser();
    const id = await createProject(ctx);
    const res = await ctx.agent.post(`/projects/${id}/analysis`).type('form').send({
      _csrf: ctx.csrf, summary: 'A shared garden.', goals: 'Grow food\n\n  Build community  ', risks: 'Water access',
    });
    expect(res.status).toBe(302);
    let p = await Project.findById(id).lean();
    expect(p.analysis.goals).toEqual(['Grow food', 'Build community']);
    expect(p.analysis.risks).toEqual(['Water access']);

    await api(ctx, 'post', `/projects/${id}/graph/nodes`, { type: 'assumption', title: 'City lends the lot' });
    const page = await ctx.agent.get(`/projects/${id}/analysis`);
    expect(page.text).toContain('City lends the lot');
    expect(page.text).not.toContain('sync-map');
    p = await Project.findById(id).lean();
    expect(p.analysis.assumptions).toEqual(['City lends the lot']);

    // An item the user removes is not copied back on the next visit.
    await ctx.agent.post(`/projects/${id}/analysis`).type('form').send({ _csrf: ctx.csrf, summary: 'A shared garden.', goals: 'Grow food', assumptions: '' });
    await ctx.agent.get(`/projects/${id}/analysis`);
    p = await Project.findById(id).lean();
    expect(p.analysis.assumptions).toEqual([]);
  });
});
