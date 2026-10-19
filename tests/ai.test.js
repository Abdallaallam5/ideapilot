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

async function setup() {
  const ctx = await registerUser();
  const id = await createProject(ctx);
  return { ctx, id };
}

describe('AI disabled', () => {
  test('explains that AI is not configured and the app keeps working', async () => {
    const { ctx, id } = await setup();
    const res = await api(ctx, 'post', `/projects/${id}/ai/analyze`, {});
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('NOT_CONFIGURED');
    expect(res.body.error).toContain('AI_API_KEY');
    expect(await Proposal.countDocuments()).toBe(0);
    const page = await ctx.agent.get(`/projects/${id}/map`);
    expect(page.text).toContain('The IdeaPilot assistant is not turned on');
    // Manual features still work.
    const node = await api(ctx, 'post', `/projects/${id}/graph/nodes`, { type: 'goal', title: 'Manual goal' });
    expect(node.status).toBe(201);
  });

  test('the API key never reaches the browser', async () => {
    aiService.setConfigForTests({ ...ENABLED, apiKey: 'super-secret-key-123' });
    const { ctx, id } = await setup();
    for (const path of ['map', 'analysis', 'roadmap', 'tasks', 'history']) {
      const page = await ctx.agent.get(`/projects/${id}/${path}`);
      expect(page.text).not.toContain('super-secret-key-123');
    }
    const status = await api(ctx, 'get', `/projects/${id}/ai/status`);
    expect(JSON.stringify(status.body)).not.toContain('super-secret-key-123');
  });
});

describe('AI provider errors', () => {
  test('a provider error is reported as a failure, recorded, and creates no proposal', async () => {
    aiService.setConfigForTests(ENABLED);
    aiService.setProviderForTests({ generate: async () => { const e = new Error('Request contains an invalid argument.'); e.status = 400; throw e; } });
    const { ctx, id } = await setup();
    const res = await api(ctx, 'post', `/projects/${id}/ai/analyze`, {});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('PROVIDER');
    expect(await Proposal.countDocuments()).toBe(0);
    const conv = await AIConversation.findOne().lean();
    expect(conv.status).toBe('failed');
  });

  test('an overloaded model is reported as busy', async () => {
    aiService.setConfigForTests(ENABLED);
    aiService.setProviderForTests({ generate: async () => { const e = new Error('This model is currently experiencing high demand.'); e.status = 503; throw e; } });
    const { ctx, id } = await setup();
    const res = await api(ctx, 'post', `/projects/${id}/ai/analyze`, {});
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PROVIDER_BUSY');
  });

  test('a busy model is retried once before giving up', async () => {
    aiService.setConfigForTests(ENABLED);
    let calls = 0;
    aiService.setProviderForTests({
      generate: async () => {
        calls += 1;
        if (calls === 1) { const e = new Error('high demand'); e.status = 503; throw e; }
        return { text: JSON.stringify({ answer: 'Start small.', followUps: [] }) };
      },
    });
    const { ctx, id } = await setup();
    const res = await api(ctx, 'post', `/projects/${id}/ai/chat`, { question: 'Where do I start?' });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  test('timeouts are enforced', async () => {
    aiService.setConfigForTests({ ...ENABLED, timeoutMs: 100 });
    aiService.setProviderForTests({ generate: () => new Promise(() => {}) });
    const { ctx, id } = await setup();
    const started = Date.now();
    const res = await api(ctx, 'post', `/projects/${id}/ai/roadmap`, {});
    expect(res.status).toBe(504);
    expect(res.body.code).toBe('TIMEOUT');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test('output that does not match the schema is discarded', async () => {
    aiService.setConfigForTests(ENABLED);
    aiService.setProviderForTests(reply({ summary: 'ok', goals: 'not-an-array' }));
    const { ctx, id } = await setup();
    const res = await api(ctx, 'post', `/projects/${id}/ai/analyze`, {});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('INVALID_OUTPUT');
    aiService.setProviderForTests({ generate: async () => ({ text: '{ not json' }) });
    const res2 = await api(ctx, 'post', `/projects/${id}/ai/analyze`, {});
    expect(res2.body.code).toBe('INVALID_OUTPUT');
    expect(await Proposal.countDocuments()).toBe(0);
  });

  test('invalid credentials and rate limits from the provider map to clear messages', () => {
    expect(aiService.mapProviderError(Object.assign(new Error('API key not valid'), { status: 400 })).code).toBe('AUTH');
    expect(aiService.mapProviderError(Object.assign(new Error('Resource exhausted'), { status: 429 })).code).toBe('PROVIDER_RATE_LIMIT');
  });

  test('form submissions get a flash message instead of a fake success', async () => {
    aiService.setConfigForTests(ENABLED);
    aiService.setProviderForTests({ generate: async () => { throw new Error('boom'); } });
    const { ctx, id } = await setup();
    const res = await ctx.agent.post(`/projects/${id}/ai/analyze`).type('form').set('Referer', `/projects/${id}/analysis`).send({ _csrf: ctx.csrf });
    expect(res.status).toBe(302);
    const page = await ctx.agent.get(`/projects/${id}/analysis`);
    expect(page.text).toContain('The IdeaPilot assistant ran into an error');
  });

  test('per-user daily limit is enforced', async () => {
    aiService.setConfigForTests({ ...ENABLED, dailyLimit: 1 });
    aiService.setProviderForTests(reply({ answer: 'Start small.', followUps: [] }));
    const { ctx, id } = await setup();
    const first = await api(ctx, 'post', `/projects/${id}/ai/chat`, { question: 'Where do I start?' });
    expect(first.status).toBe(200);
    expect(first.body.answer).toBe('Start small.');
    const second = await api(ctx, 'post', `/projects/${id}/ai/chat`, { question: 'And then?' });
    expect(second.status).toBe(429);
    expect(second.body.code).toBe('QUOTA');
  });
});

describe('AI proposals require approval', () => {
  test('graph suggestions become a proposal; only selected items are applied and bad references are dropped', async () => {
    aiService.setConfigForTests(ENABLED);
    aiService.setProviderForTests(reply({
      rationale: 'You are missing risks.',
      nodes: [
        { key: 'k1', type: 'risk', title: 'Vandalism', description: '' },
        { key: 'k2', type: 'resource', title: 'Tool shed', description: 'Shared tools' },
      ],
      edges: [
        { source: 'k1', target: 'N1', relationship: 'blocks', description: '' },
        { source: 'k2', target: 'N1', relationship: 'supports', description: '' },
        { source: 'k1', target: 'N99', relationship: 'blocks', description: 'unknown ref' },
      ],
    }));
    const { ctx, id } = await setup();
    const res = await api(ctx, 'post', `/projects/${id}/ai/graph`, {});
    expect(res.status).toBe(201);
    const proposal = await Proposal.findById(res.body.proposalId).lean();
    expect(proposal.payload.edges).toHaveLength(2);
    expect(proposal.payload.droppedEdges).toBe(1);
    expect(await IdeaNode.countDocuments({ project: id })).toBe(1);

    const accept = await ctx.agent.post(`/projects/${id}/proposals/${proposal._id}/accept`).type('form').send({ _csrf: ctx.csrf, items: ['node:0', 'edge:0', 'edge:1'] });
    expect(accept.status).toBe(302);
    const nodes = await IdeaNode.find({ project: id }).lean();
    expect(nodes.map((n) => n.title).sort()).toEqual(['Community garden', 'Vandalism']);
    expect(nodes.find((n) => n.title === 'Vandalism').metadata.source).toBe('ai');
    expect(await IdeaEdge.countDocuments({ project: id })).toBe(1);
  });

  test('an AI roadmap is applied as a new plan version with cyclic dependencies removed', async () => {
    aiService.setConfigForTests(ENABLED);
    aiService.setProviderForTests(reply({
      title: 'Garden roadmap', objective: 'Open the garden', rationale: 'Phased approach',
      phases: [
        { title: 'Prepare', description: '', milestones: [{ title: 'Lot cleared', description: '' }], tasks: [
          { key: 't1', title: 'Clear the lot', description: '', priority: 'high', deliverables: [], completionCriteria: '', dependsOn: ['t2'] },
          { key: 't2', title: 'Get tools', description: '', priority: 'medium', deliverables: ['Tool list'], completionCriteria: '', dependsOn: ['t1'] },
        ] },
        { title: 'Plant', description: '', milestones: [], tasks: [
          { key: 't3', title: 'Plant seeds', description: '', priority: 'medium', deliverables: [], completionCriteria: 'All beds planted', dependsOn: ['t1', 't3', 'nope'] },
        ] },
      ],
    }));
    const { ctx, id } = await setup();
    await api(ctx, 'post', `/projects/${id}/tasks`, { title: 'Existing manual task' });
    const res = await api(ctx, 'post', `/projects/${id}/ai/roadmap`, {});
    expect(res.status).toBe(201);
    const proposal = await Proposal.findById(res.body.proposalId).lean();
    expect(proposal.payload.droppedDeps).toBe(3);
    expect(await Plan.countDocuments({ project: id })).toBe(1);

    const accept = await ctx.agent.post(`/projects/${id}/proposals/${proposal._id}/accept`).type('form').send({ _csrf: ctx.csrf, items: ['phase:0', 'phase:1'], mode: 'replace' });
    expect(accept.status).toBe(302);
    const project = await Project.findById(id).lean();
    expect(project.currentPlanVersion).toBe(2);
    const tasks = await Task.find({ project: id }).lean();
    expect(tasks.map((t) => t.title).sort()).toEqual(['Clear the lot', 'Get tools', 'Plant seeds']);
    const v1 = await Plan.findOne({ project: id, version: 1 }).lean();
    expect(v1.tasksSnapshot.map((t) => t.title)).toEqual(['Existing manual task']);
    expect(tasks.every((t) => t.deadline === null)).toBe(true);
  });

  test('schemas convert to provider JSON schema without unsupported keywords', () => {
    const json = toProviderSchema(schemas.roadmapOutput);
    expect(json.type).toBe('object');
    expect(JSON.stringify(json)).not.toContain('$schema');
    expect(json.required.includes('phases')).toBe(true);
    expect(JSON.stringify(json)).not.toContain('maxItems');
  });

  test('over-long arrays from the model are trimmed to the schema limits', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ key: `n${i}`, type: 'idea', title: `Node ${i}`, description: '' }));
    const out = schemas.graphOutput.parse(clampArrays({ rationale: 'r', nodes: many, edges: [] }, schemas.graphOutput));
    expect(out.nodes.length).toBe(25);
  });
});
