'use strict';

require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const { expect } = require('./helpers/expect');
const IdeaEdge = require('../models/IdeaEdge');
const IdeaNode = require('../models/IdeaNode');
const { startApp, stopApp, clearDatabase, registerUser, createProject, api } = require('./helpers/setup');

before(startApp);
after(stopApp);
beforeEach(clearDatabase);

async function setup() {
  const ctx = await registerUser();
  const id = await createProject(ctx);
  const base = `/projects/${id}/graph`;
  const node = async (body) => (await api(ctx, 'post', `${base}/nodes`, body)).body.node;
  return { ctx, id, base, node };
}

describe('graph persistence', () => {
  test('nodes, edges and positions are stored and reloaded from MongoDB', async () => {
    const { ctx, base, node, id } = await setup();
    const goal = await node({ type: 'goal', title: 'Feed 40 families', position: { x: 100, y: -50 } });
    const risk = await node({ type: 'risk', title: 'Water access', description: 'No tap on site' });
    expect(goal.type).toBe('goal');

    const edge = await api(ctx, 'post', `${base}/edges`, { source: risk.id, target: goal.id, relationship: 'blocks', description: 'Plants die' });
    expect(edge.status).toBe(201);

    const moved = await api(ctx, 'post', `${base}/positions`, { positions: [{ id: goal.id, x: 420.4, y: 99 }] });
    expect(moved.body.updated).toBe(1);

    const upd = await api(ctx, 'patch', `${base}/nodes/${risk.id}`, { title: 'Water access risk', status: 'validated', priority: 'high' });
    expect(upd.status).toBe(200);
    const updEdge = await api(ctx, 'patch', `${base}/edges/${edge.body.edge.id}`, { relationship: 'influences' });
    expect(updEdge.body.edge.relationship).toBe('influences');

    const graph = await api(ctx, 'get', base);
    expect(graph.status).toBe(200);
    expect(graph.body.nodes).toHaveLength(3);
    const g = graph.body.nodes.find((n) => n.id === goal.id);
    expect(g.position).toEqual({ x: 420.4, y: 99 });
    expect(graph.body.nodes.find((n) => n.id === risk.id).status).toBe('validated');
    expect(graph.body.edges).toHaveLength(1);
    expect(graph.body.edges[0].relationship).toBe('influences');

    // The map page embeds the same data safely for the browser script.
    const page = await ctx.agent.get(`/projects/${id}/map`);
    expect(page.text).toContain('id="graphData"');
    expect(page.text).toContain('Water access risk');
  });

  test('graph data embedded in the page escapes HTML', async () => {
    const { ctx, node, id } = await setup();
    await node({ type: 'note', title: '</script><script>alert(1)</script>' });
    const page = await ctx.agent.get(`/projects/${id}/map`);
    expect(page.text).not.toContain('</script><script>alert(1)');
    expect(page.text).toContain('\\u003c/script\\u003e');
  });

  test('deleting a node removes its connections and unlinks tasks', async () => {
    const { ctx, base, node, id } = await setup();
    const a = await node({ type: 'goal', title: 'A' });
    const b = await node({ type: 'risk', title: 'B' });
    await api(ctx, 'post', `${base}/edges`, { source: a.id, target: b.id, relationship: 'related_to' });
    await ctx.agent.post(`/projects/${id}/tasks`).type('form').send({ _csrf: ctx.csrf, title: 'Linked', linkedNode: a.id });
    const res = await api(ctx, 'delete', `${base}/nodes/${a.id}`);
    expect(res.status).toBe(200);
    expect(res.body.deletedEdges).toBe(1);
    expect(await IdeaEdge.countDocuments({})).toBe(0);
    const tasks = await api(ctx, 'get', `/projects/${id}/graph`);
    expect(tasks.body.nodes.some((n) => n.id === a.id)).toBe(false);
  });
});

describe('graph validation', () => {
  test('rejects invalid node types, relationships and payloads', async () => {
    const { ctx, base, node } = await setup();
    const badType = await api(ctx, 'post', `${base}/nodes`, { type: 'spaceship', title: 'x' });
    expect(badType.status).toBe(422);
    const noTitle = await api(ctx, 'post', `${base}/nodes`, { type: 'goal', title: '   ' });
    expect(noTitle.status).toBe(422);
    const extra = await api(ctx, 'post', `${base}/nodes`, { type: 'goal', title: 'x', project: '000000000000000000000000' });
    expect(extra.status).toBe(422);

    const a = await node({ type: 'goal', title: 'A' });
    const b = await node({ type: 'goal', title: 'B' });
    const badRel = await api(ctx, 'post', `${base}/edges`, { source: a.id, target: b.id, relationship: 'loves' });
    expect(badRel.status).toBe(422);
    const self = await api(ctx, 'post', `${base}/edges`, { source: a.id, target: a.id, relationship: 'supports' });
    expect(self.status).toBe(422);
    const ok = await api(ctx, 'post', `${base}/edges`, { source: a.id, target: b.id, relationship: 'supports' });
    expect(ok.status).toBe(201);
    const dup = await api(ctx, 'post', `${base}/edges`, { source: a.id, target: b.id, relationship: 'supports' });
    expect(dup.status).toBe(409);
    const missing = await api(ctx, 'post', `${base}/edges`, { source: a.id, target: '0123456789abcdef01234567', relationship: 'supports' });
    expect(missing.status).toBe(400);
  });

  test('cannot connect to a node that belongs to another user\'s project', async () => {
    const mine = await setup();
    const theirs = await setup();
    const myNode = await mine.node({ type: 'goal', title: 'Mine' });
    const theirNode = await theirs.node({ type: 'goal', title: 'Theirs' });
    const res = await api(mine.ctx, 'post', `${mine.base}/edges`, { source: myNode.id, target: theirNode.id, relationship: 'supports' });
    expect(res.status).toBe(400);
    const patchOther = await api(mine.ctx, 'patch', `${mine.base}/nodes/${theirNode.id}`, { title: 'Stolen' });
    expect(patchOther.status).toBe(404);
    const moveOther = await api(mine.ctx, 'post', `${mine.base}/positions`, { positions: [{ id: theirNode.id, x: 1, y: 1 }] });
    expect(moveOther.body.updated).toBe(0);
    expect((await IdeaNode.findById(theirNode.id).lean()).title).toBe('Theirs');
  });
});
