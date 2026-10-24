'use strict';

require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach } = require('node:test');
const { expect } = require('./helpers/expect');
const aiService = require('../services/aiService');
const AIConversation = require('../models/AIConversation');
const Proposal = require('../models/Proposal');
const IdeaNode = require('../models/IdeaNode');
const IdeaEdge = require('../models/IdeaEdge');
const Task = require('../models/Task');
const Plan = require('../models/Plan');
const Project = require('../models/Project');
const { toProviderSchema, clampArrays } = require('../services/aiProviders');
const schemas = require('../validators/aiSchemas');
const { startApp, stopApp, clearDatabase, registerUser, createProject, api } = require('./helpers/setup');

before(startApp);
after(stopApp);
beforeEach(clearDatabase);
afterEach(() => {
  aiService.setProviderForTests(null);
  aiService.setConfigForTests(null);
});

const ENABLED = { enabled: true, reason: null, apiKey: 'test-key', model: 'test-model', provider: 'google', timeoutMs: 300, dailyLimit: 50 };
const reply = (obj) => ({ generate: async () => ({ text: JSON.stringify(obj), usage: { inputTokens: 10, outputTokens: 20 } }) });

const IDEA_TEXT = 'I want to start a small home bakery with my sister. We want to sell 50 boxes a week. We worry about the food permit. We have an oven.';
const IDEA_REPLY = {
  title: 'Home bakery',
  description: 'A small home bakery run by two sisters.',
  nodes: [
    { key: 'k1', type: 'goal', title: 'Sell 50 boxes a week', description: '' },
    { key: 'k2', type: 'person', title: 'My sister', description: 'Co-founder' },
    { key: 'k3', type: 'risk', title: 'Food permit', description: '' },
    { key: 'k4', type: 'resource', title: 'Home oven', description: '' },
  ],
  edges: [
    { source: 'k1', target: 'IDEA', relationship: 'part_of', description: '' },
    { source: 'k3', target: 'k1', relationship: 'blocks', description: '' },
    { source: 'k4', target: 'IDEA', relationship: 'supports', description: '' },
    { source: 'k9', target: 'IDEA', relationship: 'supports', description: 'unknown node' },
  ],
};

function postForm(ctx, url, body) {
  return ctx.agent.post(url).type('form').send({ _csrf: ctx.csrf, ...body });
}

describe('write your idea', () => {
  test('the text becomes a project and a map proposal; only approved items reach the map', async () => {
    aiService.setConfigForTests(ENABLED);
    aiService.setProviderForTests(reply(IDEA_REPLY));
    const ctx = await registerUser();
    const res = await postForm(ctx, '/projects/from-text', { text: IDEA_TEXT });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/projects\/[a-f0-9]{24}\/proposals\/[a-f0-9]{24}$/);

    const project = await Project.findOne().lean();
    expect(project.title).toBe('Home bakery');
    // Nothing but the idea itself is on the map until the customer approves.
    expect(await IdeaNode.countDocuments({ project: project._id })).toBe(1);
    const proposal = await Proposal.findOne().lean();
    expect(proposal.kind).toBe('graph');
    expect(proposal.payload.nodes.length).toBe(4);
    expect(proposal.payload.droppedEdges).toBe(1);
    const conv = await AIConversation.findOne().lean();
    expect(String(conv.project)).toBe(String(project._id));

    const page = await ctx.agent.get(res.headers.location);
    expect(page.status).toBe(200);
    expect(page.text).toContain('My sister');
    expect(page.text).toContain('Home bakery'); // the idea named as an edge end

    // Untick the sister (node 1); keep the rest.
    const accept = await postForm(ctx, `${res.headers.location}/accept`, { items: ['node:0', 'node:2', 'node:3', 'edge:0', 'edge:1', 'edge:2'] });
    expect(accept.status).toBe(302);
    expect(accept.headers.location).toBe(`/projects/${project._id}/map`);
    const nodes = await IdeaNode.find({ project: project._id }).lean();
    expect(nodes.map((n) => n.type).sort()).toEqual(['goal', 'idea', 'resource', 'risk']);
    expect(await IdeaEdge.countDocuments({ project: project._id })).toBe(3);
    // New nodes are spread around the idea, not stacked on it.
    const spots = new Set(nodes.map((n) => `${n.position.x},${n.position.y}`));
    expect(spots.size).toBe(nodes.length);
  });

  test('the idea comes with a ready-made roadmap and fills the analysis on accept', async () => {
    aiService.setConfigForTests(ENABLED);
    aiService.setProviderForTests(reply({ ...IDEA_REPLY, phases: [
      { title: 'Prepare', description: 'Get ready to sell.', milestones: ['Permit approved'], tasks: [{ title: 'Apply for the food permit', priority: 'high' }, { title: 'Test recipes', priority: 'medium' }] },
      { title: 'Launch', description: '', milestones: ['First 10 orders'], tasks: [{ title: 'Open the Instagram page', priority: 'medium' }] },
      { title: 'Skipped phase', description: '', milestones: [], tasks: [{ title: 'Should not appear', priority: 'low' }] },
    ] }));
    const ctx = await registerUser();
    const res = await postForm(ctx, '/projects/from-text', { text: IDEA_TEXT });
    const page = await ctx.agent.get(res.headers.location);
    expect(page.text).toContain('Ready-made roadmap');
    expect(page.text).toContain('Apply for the food permit');

    const accept = await postForm(ctx, `${res.headers.location}/accept`, { items: ['node:0', 'node:2', 'phase:0', 'phase:1'] });
    expect(accept.status).toBe(302);
    const project = await Project.findOne().lean();
    const plan = await Plan.findOne({ project: project._id, status: 'current' }).lean();
    expect(plan.phases.map((p) => p.title)).toEqual(['Prepare', 'Launch']);
    expect(plan.phases[0].milestones.map((m) => m.title)).toEqual(['Permit approved']);
    const tasks = await Task.find({ project: project._id }).sort({ order: 1 }).lean();
    expect(tasks.map((t) => t.title).sort()).toEqual(['Apply for the food permit', 'Open the Instagram page', 'Test recipes']);
    expect(tasks.every((t) => String(t.plan) === String(plan._id))).toBe(true);
    // The analysis is filled from the approved map items without any button.
    expect(project.analysis.goals).toEqual(['Sell 50 boxes a week']);
    expect(project.analysis.risks).toEqual(['Food permit']);
    expect(project.analysis.summary).toBe('A small home bakery run by two sisters.');
  });

  test('when IdeaPilot fails, nothing is created and the text is kept with a way to continue', async () => {
    aiService.setConfigForTests(ENABLED);
    aiService.setProviderForTests({ generate: async () => { const e = new Error('Request contains an invalid argument.'); e.status = 400; throw e; } });
    const ctx = await registerUser();
    const res = await postForm(ctx, '/projects/from-text', { text: IDEA_TEXT });
    expect(res.status).toBe(502);
    expect(res.text).toContain('The IdeaPilot assistant ran into an error');
    expect(res.text).toContain('home bakery with my sister');
    expect(res.text).toContain('name="plain"');
    expect(await Project.countDocuments()).toBe(0);
    expect(await Proposal.countDocuments()).toBe(0);
    expect((await AIConversation.findOne().lean()).status).toBe('failed');

    const plain = await postForm(ctx, '/projects/from-text', { text: IDEA_TEXT, plain: 'true' });
    expect(plain.status).toBe(302);
    const project = await Project.findOne().lean();
    expect(project.description).toBe(IDEA_TEXT);
    expect(project.title.length).toBeLessThan(90);
  });

  test('without IdeaPilot configured the text still creates the project', async () => {
    const ctx = await registerUser();
    const form = await ctx.agent.get('/projects/new');
    expect(form.text).toContain('name="text"');
    const res = await postForm(ctx, '/projects/from-text', { text: 'A neighborhood book swap in the park' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/map$/);
    expect((await Project.findOne().lean()).title).toBe('A neighborhood book swap in the park');
  });

  test('a too-short text is rejected with a clear message', async () => {
    const ctx = await registerUser();
    const res = await postForm(ctx, '/projects/from-text', { text: 'cake' });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Tell us a little more about your idea');
    expect(await Project.countDocuments()).toBe(0);
  });

  test('the manual form is still available', async () => {
    const ctx = await registerUser();
    const res = await ctx.agent.get('/projects/new?manual=1');
    expect(res.text).toContain('name="title"');
  });
});

describe('write your tasks', () => {
  async function setup() {
    const ctx = await registerUser();
    const id = await createProject(ctx);
    return { ctx, id };
  }

  test('plain text becomes a task proposal with order kept; accepted tasks get dependencies', async () => {
    aiService.setConfigForTests(ENABLED);
    aiService.setProviderForTests(reply({
      tasks: [
        { key: 't1', title: 'Photograph the products', description: '', priority: 'high', phase: '', linkedNode: 'N1', dependsOn: [] },
        { key: 't2', title: 'Open an Instagram page', description: '', priority: 'medium', phase: 'P9', linkedNode: '', dependsOn: ['t1'] },
        { key: 't3', title: 'Call the supplier', description: '', priority: 'medium', phase: '', linkedNode: '', dependsOn: ['t3', 'zz'] },
      ],
    }));
    const { ctx, id } = await setup();
    const res = await postForm(ctx, `/projects/${id}/tasks/from-text`, { text: 'photograph products urgently, then open instagram, call the supplier' });
    expect(res.status).toBe(302);
    const proposal = await Proposal.findOne().lean();
    expect(proposal.kind).toBe('taskdraft');
    expect(proposal.payload.droppedDeps).toBe(2);
    expect(proposal.payload.tasks[0].linkedNode).toBeTruthy();
    expect(proposal.payload.tasks[1].phaseId).toBe(null);
    expect(await Task.countDocuments()).toBe(0);

    const page = await ctx.agent.get(res.headers.location);
    expect(page.text).toContain('Photograph the products');

    const accept = await postForm(ctx, `${res.headers.location}/accept`, { items: ['task:0', 'task:1'] });
    expect(accept.status).toBe(302);
    expect(accept.headers.location).toBe(`/projects/${id}/tasks`);
    const tasks = await Task.find({ project: id }).lean();
    expect(tasks.map((t) => t.title).sort()).toEqual(['Open an Instagram page', 'Photograph the products']);
    const photo = tasks.find((t) => t.title === 'Photograph the products');
    const insta = tasks.find((t) => t.title === 'Open an Instagram page');
    expect(insta.dependencies.map(String)).toEqual([String(photo._id)]);
    expect(photo.priority).toBe('high');
    expect(await Plan.countDocuments({ project: id })).toBe(2);
  });

  test('a failure shows the error and keeps what the customer wrote', async () => {
    aiService.setConfigForTests(ENABLED);
    aiService.setProviderForTests({ generate: async () => { throw new Error('boom'); } });
    const { ctx, id } = await setup();
    const res = await postForm(ctx, `/projects/${id}/tasks/from-text`, { text: 'call the supplier tomorrow' });
    expect(res.status).toBe(302);
    const page = await ctx.agent.get(`/projects/${id}/tasks`);
    expect(page.text).toContain('The IdeaPilot assistant ran into an error');
    expect(page.text).toContain('call the supplier tomorrow');
    expect(await Proposal.countDocuments()).toBe(0);
  });

  test('the box only shows when IdeaPilot is configured', async () => {
    const { ctx, id } = await setup();
    const off = await ctx.agent.get(`/projects/${id}/tasks`);
    expect(off.text).not.toContain('tasks/from-text');
    aiService.setConfigForTests(ENABLED);
    const on = await ctx.agent.get(`/projects/${id}/tasks`);
    expect(on.text).toContain('tasks/from-text');
  });

  test("another user's project cannot be used", async () => {
    aiService.setConfigForTests(ENABLED);
    const { id } = await setup();
    const other = await registerUser();
    const res = await postForm(other, `/projects/${id}/tasks/from-text`, { text: 'call the supplier' });
    expect([403, 404]).toContain(res.status);
  });
});

describe('provider errors and limits', () => {
  async function tryTasks(ctx, id) {
    return api(ctx, 'post', `/projects/${id}/tasks/from-text`, { text: 'call the supplier' });
  }

  test('a busy model is retried once before giving up', async () => {
    aiService.setConfigForTests(ENABLED);
    let calls = 0;
    aiService.setProviderForTests({
      generate: async () => {
        calls += 1;
        if (calls === 1) { const e = new Error('high demand'); e.status = 503; throw e; }
        return { text: JSON.stringify({ tasks: [{ key: 't1', title: 'Call the supplier', description: '', priority: 'medium', phase: '', linkedNode: '', dependsOn: [] }] }) };
      },
    });
    const ctx = await registerUser();
    const id = await createProject(ctx);
    await postForm(ctx, `/projects/${id}/tasks/from-text`, { text: 'call the supplier' });
    expect(calls).toBe(2);
    expect(await Proposal.countDocuments()).toBe(1);
  });

  test('timeouts are enforced', async () => {
    aiService.setConfigForTests({ ...ENABLED, timeoutMs: 100 });
    aiService.setProviderForTests({ generate: () => new Promise(() => {}) });
    const ctx = await registerUser();
    const started = Date.now();
    const res = await postForm(ctx, '/projects/from-text', { text: IDEA_TEXT });
    expect(res.status).toBe(504);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test('output that does not match the schema is discarded', async () => {
    aiService.setConfigForTests(ENABLED);
    aiService.setProviderForTests(reply({ title: 'x', description: 'y', nodes: 'not-an-array', edges: [] }));
    const ctx = await registerUser();
    const res = await postForm(ctx, '/projects/from-text', { text: IDEA_TEXT });
    expect(res.status).toBe(502);
    expect(res.text).toContain('unexpected format');
    // The model may not add a second idea node.
    aiService.setProviderForTests(reply({ ...IDEA_REPLY, nodes: [{ key: 'k1', type: 'idea', title: 'Another idea', description: '' }] }));
    const res2 = await postForm(ctx, '/projects/from-text', { text: IDEA_TEXT });
    expect(res2.status).toBe(502);
    expect(await Project.countDocuments()).toBe(0);
  });

  test('invalid credentials and rate limits from the provider map to clear messages', () => {
    expect(aiService.mapProviderError(Object.assign(new Error('API key not valid'), { status: 400 })).code).toBe('AUTH');
    expect(aiService.mapProviderError(Object.assign(new Error('Resource exhausted'), { status: 429 })).code).toBe('PROVIDER_RATE_LIMIT');
  });

  test('per-user daily limit is enforced', async () => {
    aiService.setConfigForTests({ ...ENABLED, dailyLimit: 1 });
    aiService.setProviderForTests(reply({ tasks: [{ key: 't1', title: 'Call the supplier', description: '', priority: 'medium', phase: '', linkedNode: '', dependsOn: [] }] }));
    const ctx = await registerUser();
    const id = await createProject(ctx);
    const first = await tryTasks(ctx, id);
    expect(first.status).toBe(302);
    await postForm(ctx, `/projects/${id}/tasks/from-text`, { text: 'and email the bank' });
    const page = await ctx.agent.get(`/projects/${id}/tasks`);
    expect(page.text).toContain('daily IdeaPilot assistant limit');
    expect(await Proposal.countDocuments()).toBe(1);
  });

  test('the assistant panel and its old endpoints are gone', async () => {
    aiService.setConfigForTests(ENABLED);
    const ctx = await registerUser();
    const id = await createProject(ctx);
    const map = await ctx.agent.get(`/projects/${id}/map`);
    expect(map.text).not.toContain('aiPanel');
    const res = await api(ctx, 'post', `/projects/${id}/ai/chat`, { question: 'hi' });
    expect(res.status).toBe(404);
  });

  test('opening the form URLs directly goes back to the form instead of a 404', async () => {
    const ctx = await registerUser();
    const id = await createProject(ctx);
    const idea = await ctx.agent.get('/projects/from-text');
    expect(idea.status).toBe(302);
    expect(idea.headers.location).toBe('/projects/new');
    const tasks = await ctx.agent.get(`/projects/${id}/tasks/from-text`);
    expect(tasks.status).toBe(302);
    expect(tasks.headers.location).toBe(`/projects/${id}/tasks`);
  });

  test('schemas convert to provider JSON schema without unsupported keywords', () => {
    const json = toProviderSchema(schemas.ideaOutput);
    expect(json.type).toBe('object');
    expect(JSON.stringify(json)).not.toContain('$schema');
    expect(json.required.includes('nodes')).toBe(true);
    expect(JSON.stringify(json)).not.toContain('maxItems');
  });

  test('over-long arrays from the model are trimmed to the schema limits', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ key: `n${i}`, type: 'goal', title: `Node ${i}`, description: '' }));
    const out = schemas.ideaOutput.parse(clampArrays({ title: 't', description: 'd', nodes: many, edges: [] }, schemas.ideaOutput));
    expect(out.nodes.length).toBe(25);
  });
});
