'use strict';

require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const { expect } = require('./helpers/expect');
const Task = require('../models/Task');
const Activity = require('../models/Activity');
const taskService = require('../services/taskService');
const { startApp, stopApp, clearDatabase, registerUser, createProject, api } = require('./helpers/setup');

before(startApp);
after(stopApp);
beforeEach(clearDatabase);

async function setup() {
  const ctx = await registerUser();
  const id = await createProject(ctx);
  const create = async (body) => {
    const res = await api(ctx, 'post', `/projects/${id}/tasks`, body);
    if (res.status !== 201) throw new Error(`Task create failed ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.task;
  };
  return { ctx, id, create };
}

describe('task status changes and completion tracking', () => {
  test('status changes persist, set completedAt and update progress', async () => {
    const { ctx, id, create } = await setup();
    const a = await create({ title: 'Survey the lot' });
    await create({ title: 'Ask the city' });
    const res = await api(ctx, 'patch', `/projects/${id}/tasks/${a.id}`, { status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.task.status).toBe('completed');
    expect(res.body.progress).toEqual({ total: 2, completed: 1, percent: 50 });
    const stored = await Task.findById(a.id).lean();
    expect(stored.completedAt instanceof Date).toBe(true);
    expect(await Activity.countDocuments({ type: 'task_status_changed' })).toBe(1);

    const back = await api(ctx, 'patch', `/projects/${id}/tasks/${a.id}`, { status: 'todo' });
    expect(back.body.task.completedAt).toBeNull();
    const invalid = await api(ctx, 'patch', `/projects/${id}/tasks/${a.id}`, { status: 'finished' });
    expect(invalid.status).toBe(422);
  });

  test('a task cannot be completed while its dependencies are unfinished', async () => {
    const { ctx, id, create } = await setup();
    const first = await create({ title: 'Get permission' });
    const second = await create({ title: 'Plant seeds', dependencies: [first.id] });
    const blocked = await api(ctx, 'patch', `/projects/${id}/tasks/${second.id}`, { status: 'completed' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toContain('Get permission');
    await api(ctx, 'patch', `/projects/${id}/tasks/${first.id}`, { status: 'completed' });
    const ok = await api(ctx, 'patch', `/projects/${id}/tasks/${second.id}`, { status: 'completed' });
    expect(ok.status).toBe(200);
  });

  test('overdue and waiting flags are computed', async () => {
    const tasks = taskService.decorateTasks([
      { _id: 'a', title: 'A', status: 'todo', dependencies: [], deadline: new Date('2001-01-01') },
      { _id: 'b', title: 'B', status: 'todo', dependencies: ['a'], deadline: null },
      { _id: 'c', title: 'C', status: 'completed', dependencies: [], deadline: new Date('2001-01-01') },
    ]);
    expect(tasks[0].isOverdue).toBe(true);
    expect(tasks[1].isBlocked).toBe(true);
    expect(tasks[1].waitingOn).toHaveLength(1);
    expect(tasks[2].isOverdue).toBe(false);
  });

  test('form edits validate and persist deliverables, deadline and criteria', async () => {
    const { ctx, id, create } = await setup();
    const t = await create({ title: 'Draft flyer' });
    const res = await ctx.agent.post(`/projects/${id}/tasks/${t.id}/update`).type('form').send({
      _csrf: ctx.csrf, title: 'Draft the flyer', priority: 'high', status: 'in_progress', deadline: '2031-05-01',
      deliverables: 'PDF flyer\nPrinted copies', completionCriteria: 'Approved by two neighbors',
    });
    expect(res.status).toBe(302);
    const stored = await Task.findById(t.id).lean();
    expect(stored.deliverables).toEqual(['PDF flyer', 'Printed copies']);
    expect(stored.deadline.toISOString().slice(0, 10)).toBe('2031-05-01');
    const bad = await ctx.agent.post(`/projects/${id}/tasks/${t.id}/update`).type('form').send({ _csrf: ctx.csrf, title: '', deadline: 'not-a-date' });
    expect(bad.status).toBe(422);
  });
});

describe('dependency validation', () => {
  test('prevents self-dependencies and circular dependencies', async () => {
    const { ctx, id, create } = await setup();
    const a = await create({ title: 'A' });
    const b = await create({ title: 'B', dependencies: [a.id] });
    const c = await create({ title: 'C', dependencies: [b.id] });

    const self = await ctx.agent.post(`/projects/${id}/tasks/${a.id}/update`).set('Accept', 'application/json').set('X-CSRF-Token', ctx.csrf)
      .type('form').send({ title: 'A', dependencies: a.id });
    expect(self.status).toBe(422);

    // A -> C would close the loop A -> C -> B -> A.
    const cycle = await ctx.agent.post(`/projects/${id}/tasks/${a.id}/update`).type('form').send({ _csrf: ctx.csrf, title: 'A', dependencies: c.id });
    expect(cycle.status).toBe(422);
    expect(cycle.text).toContain('circular');
    expect((await Task.findById(a.id).lean()).dependencies).toHaveLength(0);
  });

  test('wouldCreateCycle detects indirect loops', () => {
    const graph = new Map([['b', ['a']], ['c', ['b']]]);
    expect(taskService.wouldCreateCycle(graph, 'a', ['c'])).toBe(true);
    expect(taskService.wouldCreateCycle(graph, 'd', ['c'])).toBe(false);
  });

  test('rejects dependencies on tasks from another project', async () => {
    const one = await setup();
    const two = await setup();
    const foreign = await two.create({ title: 'Foreign' });
    const res = await api(one.ctx, 'post', `/projects/${one.id}/tasks`, { title: 'Mine', dependencies: [foreign.id] });
    expect(res.status).toBe(422);
  });

  test('deleting a task removes it from other tasks\' dependencies', async () => {
    const { ctx, id, create } = await setup();
    const a = await create({ title: 'A' });
    const b = await create({ title: 'B', dependencies: [a.id] });
    await api(ctx, 'post', `/projects/${id}/tasks/${a.id}/delete`, {});
    expect((await Task.findById(b.id).lean()).dependencies).toHaveLength(0);
  });
});

describe('ordering and views', () => {
  test('reorders tasks and moves them between phases', async () => {
    const { ctx, id, create } = await setup();
    const phaseRes = await ctx.agent.post(`/projects/${id}/plan/phases`).type('form').send({ _csrf: ctx.csrf, title: 'Build' });
    expect(phaseRes.status).toBe(302);
    const roadmap = await ctx.agent.get(`/projects/${id}/roadmap`);
    const phaseId = /data-phase-id="([a-f0-9]{24})"/.exec(roadmap.text)[1];
    const a = await create({ title: 'A' });
    const b = await create({ title: 'B' });
    const res = await api(ctx, 'post', `/projects/${id}/tasks/reorder`, { orderedIds: [b.id, a.id], phaseId });
    expect(res.status).toBe(200);
    const stored = await Task.find({ project: id }).sort({ order: 1 }).lean();
    expect(stored.map((t) => t.title)).toEqual(['B', 'A']);
    expect(String(stored[0].phaseId)).toBe(phaseId);
  });

  test('list and kanban views render real tasks', async () => {
    const { ctx, id, create } = await setup();
    await create({ title: 'Visible task', status: 'blocked', blockedReason: 'Waiting for the city' });
    const list = await ctx.agent.get(`/projects/${id}/tasks?view=list`);
    expect(list.text).toContain('Visible task');
    const kanban = await ctx.agent.get(`/projects/${id}/tasks?view=kanban`);
    expect(kanban.text).toContain('data-kanban-list data-status="blocked"');
    expect(kanban.text).toContain('Visible task');
    const filtered = await ctx.agent.get(`/projects/${id}/tasks?view=list&status=completed`);
    expect(filtered.text).toContain('No tasks match these filters.');
  });
});
