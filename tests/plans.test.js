'use strict';

require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const { expect } = require('./helpers/expect');
const Plan = require('../models/Plan');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Proposal = require('../models/Proposal');
const Decision = require('../models/Decision');
const IdeaNode = require('../models/IdeaNode');
const graphService = require('../services/graphService');
const { startApp, stopApp, clearDatabase, registerUser, createProject, api } = require('./helpers/setup');

before(startApp);
after(stopApp);
beforeEach(clearDatabase);

async function setup() {
  const ctx = await registerUser();
  const id = await createProject(ctx);
  const task = async (body) => (await api(ctx, 'post', `/projects/${id}/tasks`, body)).body.task;
  const node = async (body) => (await api(ctx, 'post', `/projects/${id}/graph/nodes`, body)).body.node;
  const edge = (source, target, relationship) => api(ctx, 'post', `/projects/${id}/graph/edges`, { source, target, relationship });
  return { ctx, id, task, node, edge };
}

describe('phases and milestones', () => {
  test('adds, moves and deletes phases without losing tasks', async () => {
    const { ctx, id, task } = await setup();
    await ctx.agent.post(`/projects/${id}/plan/phases`).type('form').send({ _csrf: ctx.csrf, title: 'Research' });
    await ctx.agent.post(`/projects/${id}/plan/phases`).type('form').send({ _csrf: ctx.csrf, title: 'Launch' });
    let plan = await Plan.findOne({ project: id, status: 'current' });
    const [research, launch] = plan.phases;
    await ctx.agent.post(`/projects/${id}/plan/phases/${launch._id}/move`).type('form').send({ _csrf: ctx.csrf, direction: 'up' });
    plan = await Plan.findById(plan._id);
    expect(plan.phases.id(launch._id).order).toBe(0);
    expect(plan.phases.id(research._id).order).toBe(1);

    await ctx.agent.post(`/projects/${id}/plan/phases/${research._id}/milestones`).type('form').send({ _csrf: ctx.csrf, title: 'Interviews done' });
    plan = await Plan.findById(plan._id);
    const ms = plan.phases.id(research._id).milestones[0];
    await ctx.agent.post(`/projects/${id}/plan/phases/${research._id}/milestones/${ms._id}/toggle`).type('form').send({ _csrf: ctx.csrf, completed: 'true' });
    plan = await Plan.findById(plan._id);
    expect(plan.phases.id(research._id).milestones[0].completed).toBe(true);

    const t = await task({ title: 'Interview 5 people', phaseId: String(research._id), milestoneId: String(ms._id) });
    const wrongMs = await api(ctx, 'post', `/projects/${id}/tasks`, { title: 'x', phaseId: String(launch._id), milestoneId: String(ms._id) });
    expect(wrongMs.status).toBe(422);

    await ctx.agent.post(`/projects/${id}/plan/phases/${research._id}/delete`).type('form').send({ _csrf: ctx.csrf });
    const stored = await Task.findById(t.id).lean();
    expect(stored).toBeTruthy();
    expect(stored.phaseId).toBeNull();
  });
});

describe('plan versioning', () => {
  test('saving a version freezes the old plan and restoring brings its tasks back', async () => {
    const { ctx, id, task } = await setup();
    await ctx.agent.post(`/projects/${id}/plan/phases`).type('form').send({ _csrf: ctx.csrf, title: 'Phase one' });
    const original = await task({ title: 'Original task' });

    const save = await ctx.agent.post(`/projects/${id}/plan/versions`).type('form').send({ _csrf: ctx.csrf, changeSummary: 'Checkpoint' });
    expect(save.status).toBe(302);
    const v1 = await Plan.findOne({ project: id, version: 1 }).lean();
    expect(v1.status).toBe('archived');
    expect(v1.tasksSnapshot).toHaveLength(1);
    const project = await Project.findById(id).lean();
    expect(project.currentPlanVersion).toBe(2);

    // Change the live plan after the checkpoint.
    await api(ctx, 'post', `/projects/${id}/tasks/${original.id}/delete`, {});
    await task({ title: 'Newer task' });

    const restore = await ctx.agent.post(`/projects/${id}/plan/versions/${v1._id}/restore`).type('form').send({ _csrf: ctx.csrf });
    expect(restore.status).toBe(302);
    const titles = (await Task.find({ project: id }).lean()).map((t) => t.title);
    expect(titles).toEqual(['Original task']);
    const versions = await Plan.find({ project: id }).sort({ version: 1 }).lean();
    expect(versions.map((v) => [v.version, v.status])).toEqual([[1, 'archived'], [2, 'archived'], [3, 'current']]);
    expect(versions[1].tasksSnapshot.map((t) => t.title)).toEqual(['Newer task']);
    expect(versions[2].restoredFromVersion).toBe(1);

    const again = await ctx.agent.post(`/projects/${id}/plan/versions/${versions[2]._id}/restore`).type('form').send({ _csrf: ctx.csrf });
    expect(again.status).toBe(409);

    const view = await ctx.agent.get(`/projects/${id}/plan/versions/${versions[1]._id}`);
    expect(view.status).toBe(200);
    expect(view.text).toContain('Newer task');
  });
});

describe('replanning', () => {
  test('impact traversal follows relationship semantics deterministically', () => {
    const nodes = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => ({ _id: id, title: id }));
    const edges = [
      { source: 'A', target: 'B', relationship: 'supports' },     // A changes -> B affected
      { source: 'C', target: 'B', relationship: 'depends_on' },   // C depends on B -> C affected
      { source: 'A', target: 'D', relationship: 'alternative_to' },
      { source: 'E', target: 'A', relationship: 'supports' },     // E supports A: E is NOT affected by A
      { source: 'C', target: 'F', relationship: 'related_to' },   // related_to only one hop from start
    ];
    const result = graphService.traverseImpact(nodes, edges, 'A');
    expect(result.affected.map((a) => [a.node._id, a.depth])).toEqual([['B', 1], ['C', 2]]);
    expect(result.alternatives.map((n) => n._id)).toEqual(['D']);
  });

  test('proposes, then on acceptance blocks affected tasks, records a decision and saves a new plan version', async () => {
    const { ctx, id, task, node, edge } = await setup();
    const assumption = await node({ type: 'assumption', title: 'City lends the lot' });
    const goal = await node({ type: 'goal', title: 'Open by spring' });
    const alt = await node({ type: 'idea', title: 'Use a church yard' });
    await edge(assumption.id, goal.id, 'supports');
    await edge(alt.id, assumption.id, 'alternative_to');
    const direct = await task({ title: 'Sign the lease', linkedNode: assumption.id });
    const viaGoal = await task({ title: 'Plan opening day', linkedNode: goal.id });
    const downstream = await task({ title: 'Invite neighbors', dependencies: [viaGoal.id] });
    const unrelated = await task({ title: 'Buy gloves' });

    const res = await ctx.agent.post(`/projects/${id}/replan`).type('form').send({ _csrf: ctx.csrf, nodeId: assumption.id, changeType: 'invalidated', note: 'The city said no.' });
    expect(res.status).toBe(302);
    const proposal = await Proposal.findOne({ project: id, kind: 'replan' }).lean();
    expect(proposal.status).toBe('pending');
    const affectedIds = proposal.payload.affectedTasks.map((t) => t.id);
    expect(affectedIds.includes(direct.id)).toBe(true);
    expect(affectedIds.includes(viaGoal.id)).toBe(true);
    expect(affectedIds.includes(downstream.id)).toBe(true);
    expect(affectedIds.includes(unrelated.id)).toBe(false);
    expect(proposal.payload.newTasks.some((t) => t.title.includes('Use a church yard'))).toBe(true);

    // Nothing changed before acceptance.
    expect((await Task.findById(direct.id).lean()).status).toBe('todo');
    const page = await ctx.agent.get(`/projects/${id}/proposals/${proposal._id}`);
    expect(page.text).toContain('Sign the lease');

    // Accept everything that is selected by default.
    const items = ['node:0'];
    proposal.payload.taskChanges.forEach((c, i) => c.defaultSelected && items.push(`task:${i}`));
    proposal.payload.newTasks.forEach((t, i) => t.defaultSelected && items.push(`new:${i}`));
    const accept = await ctx.agent.post(`/projects/${id}/proposals/${proposal._id}/accept`).type('form').send({ _csrf: ctx.csrf, items });
    expect(accept.status).toBe(302);

    const directAfter = await Task.findById(direct.id).lean();
    expect(directAfter.status).toBe('blocked');
    expect(directAfter.blockedReason).toContain('City lends the lot');
    expect((await IdeaNode.findById(assumption.id).lean()).status).toBe('invalidated');
    expect((await Task.findById(unrelated.id).lean()).status).toBe('todo');
    expect(await Decision.countDocuments({ project: id })).toBe(1);
    const v1 = await Plan.findOne({ project: id, version: 1 }).lean();
    expect(v1.status).toBe('archived');
    expect(v1.tasksSnapshot.find((t) => String(t.taskId) === direct.id).status).toBe('todo');
    expect((await Project.findById(id).lean()).currentPlanVersion).toBe(2);

    const twice = await ctx.agent.post(`/projects/${id}/proposals/${proposal._id}/accept`).type('form').send({ _csrf: ctx.csrf, items });
    expect(twice.status).toBe(409);
  });

  test('rejecting a proposal changes nothing', async () => {
    const { ctx, id, task, node } = await setup();
    const decision = await node({ type: 'decision', title: 'Sell online' });
    const t = await task({ title: 'Build shop', linkedNode: decision.id });
    await ctx.agent.post(`/projects/${id}/replan`).type('form').send({ _csrf: ctx.csrf, nodeId: decision.id, changeType: 'changed' });
    const proposal = await Proposal.findOne({ project: id }).lean();
    const res = await ctx.agent.post(`/projects/${id}/proposals/${proposal._id}/reject`).type('form').send({ _csrf: ctx.csrf });
    expect(res.status).toBe(302);
    expect((await Proposal.findById(proposal._id).lean()).status).toBe('rejected');
    expect((await Task.findById(t.id).lean()).status).toBe('todo');
    expect(await Plan.countDocuments({ project: id })).toBe(1);
  });

  test('review page sums up the idea and tasks and points out what needs attention', async () => {
    const { ctx, id } = await setup();
    await api(ctx, 'post', `/projects/${id}/graph/nodes`, { type: 'risk', title: 'Water access' });
    await api(ctx, 'post', `/projects/${id}/graph/nodes`, { type: 'person', title: 'Neighbour Ali' });
    const old = await ctx.agent.get(`/projects/${id}/history`);
    expect(old.status).toBe(302);
    expect(old.headers.location).toBe(`/projects/${id}/review`);
    const page = await ctx.agent.get(`/projects/${id}/review`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Neighbour Ali');
    expect(page.text).toContain('have no task or plan to deal with them: Water access');
    expect(page.text).toContain('Next up');
    expect(page.text).toContain('v1');
  });
});
