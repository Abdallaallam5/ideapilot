'use strict';

const mongoose = require('mongoose');
const IdeaNode = require('../models/IdeaNode');
const IdeaEdge = require('../models/IdeaEdge');
const Task = require('../models/Task');
const Decision = require('../models/Decision');
const activity = require('./activityService');
const { badRequest, notFound, conflict } = require('../utils/httpError');

const MAX_NODES_PER_PROJECT = 500;
const MAX_EDGES_PER_PROJECT = 1500;

function serializeNode(n) {
  return {
    id: String(n._id),
    type: n.type,
    title: n.title,
    description: n.description || '',
    status: n.status,
    priority: n.priority,
    position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
    source: n.metadata?.source || 'manual',
    updatedAt: n.updatedAt,
  };
}

function serializeEdge(e) {
  return {
    id: String(e._id),
    source: String(e.source),
    target: String(e.target),
    relationship: e.relationship,
    description: e.description || '',
  };
}

async function getGraph(projectId) {
  const [nodes, edges] = await Promise.all([
    IdeaNode.find({ project: projectId }).sort({ createdAt: 1 }).lean(),
    IdeaEdge.find({ project: projectId }).lean(),
  ]);
  return { nodes: nodes.map(serializeNode), edges: edges.map(serializeEdge) };
}

async function findNode(projectId, nodeId) {
  if (!mongoose.isValidObjectId(nodeId)) throw notFound('Node not found.');
  const node = await IdeaNode.findOne({ _id: nodeId, project: projectId });
  if (!node) throw notFound('Node not found.');
  return node;
}

async function createNode(project, data, user, { source = 'manual', silent = false } = {}) {
  const count = await IdeaNode.countDocuments({ project: project._id });
  if (count >= MAX_NODES_PER_PROJECT) throw conflict(`A map can hold at most ${MAX_NODES_PER_PROJECT} nodes.`);
  const node = await IdeaNode.create({
    project: project._id,
    type: data.type,
    title: data.title,
    description: data.description || '',
    status: data.status || 'open',
    priority: data.priority || 'medium',
    position: data.position || { x: 0, y: 0 },
    metadata: { source },
  });
  await touch(project);
  if (!silent) await activity.record(project._id, user._id, 'node_created', `Added ${node.type} "${node.title}" to the map`, { nodeId: node._id });
  return node;
}

async function updateNode(project, nodeId, data, user) {
  const node = await findNode(project._id, nodeId);
  const contentKeys = ['type', 'title', 'description', 'status', 'priority'];
  const changed = contentKeys.filter((k) => data[k] !== undefined && data[k] !== node[k]);
  for (const k of contentKeys) if (data[k] !== undefined) node[k] = data[k];
  if (data.position) node.position = data.position;
  await node.save();
  if (changed.length) {
    await touch(project);
    await activity.record(project._id, user._id, 'node_updated', `Updated ${node.type} "${node.title}" (${changed.join(', ')})`, { nodeId: node._id, fields: changed });
  }
  return node;
}

/** Bulk-saves node positions after dragging. Only nodes of this project are touched. */
async function updatePositions(project, positions) {
  if (!positions.length) return 0;
  const ops = positions.map((p) => ({
    updateOne: { filter: { _id: p.id, project: project._id }, update: { $set: { 'position.x': p.x, 'position.y': p.y } } },
  }));
  const result = await IdeaNode.bulkWrite(ops, { ordered: false });
  return result.matchedCount;
}

async function deleteNode(project, nodeId, user) {
  const node = await findNode(project._id, nodeId);
  const edgeResult = await IdeaEdge.deleteMany({ project: project._id, $or: [{ source: node._id }, { target: node._id }] });
  await Task.updateMany({ project: project._id, linkedNode: node._id }, { $set: { linkedNode: null } });
  await Decision.updateMany({ project: project._id, relatedNode: node._id }, { $set: { relatedNode: null } });
  await node.deleteOne();
  await touch(project);
  await activity.record(project._id, user._id, 'node_deleted', `Deleted ${node.type} "${node.title}" and ${edgeResult.deletedCount} connection(s)`);
  return { deletedEdges: edgeResult.deletedCount };
}

async function createEdge(project, data, user, { silent = false } = {}) {
  if (data.source === data.target) throw badRequest('A node cannot be connected to itself.');
  const nodes = await IdeaNode.find({ _id: { $in: [data.source, data.target] }, project: project._id }).select('_id title').lean();
  if (nodes.length !== 2) throw badRequest('Both nodes must exist in this project.');
  const count = await IdeaEdge.countDocuments({ project: project._id });
  if (count >= MAX_EDGES_PER_PROJECT) throw conflict(`A map can hold at most ${MAX_EDGES_PER_PROJECT} connections.`);
  const existing = await IdeaEdge.findOne({ project: project._id, source: data.source, target: data.target, relationship: data.relationship }).lean();
  if (existing) throw conflict('These nodes are already connected with that relationship.');
  const edge = await IdeaEdge.create({
    project: project._id, source: data.source, target: data.target,
    relationship: data.relationship, description: data.description || '',
  });
  await touch(project);
  if (!silent) {
    const title = (id) => nodes.find((n) => String(n._id) === String(id))?.title;
    await activity.record(project._id, user._id, 'edge_created', `Connected "${title(data.source)}" ${edge.relationship.replace(/_/g, ' ')} "${title(data.target)}"`, { edgeId: edge._id });
  }
  return edge;
}

async function findEdge(projectId, edgeId) {
  if (!mongoose.isValidObjectId(edgeId)) throw notFound('Connection not found.');
  const edge = await IdeaEdge.findOne({ _id: edgeId, project: projectId });
  if (!edge) throw notFound('Connection not found.');
  return edge;
}

async function updateEdge(project, edgeId, data, user) {
  const edge = await findEdge(project._id, edgeId);
  if (data.relationship && data.relationship !== edge.relationship) {
    const dup = await IdeaEdge.exists({ project: project._id, source: edge.source, target: edge.target, relationship: data.relationship, _id: { $ne: edge._id } });
    if (dup) throw conflict('These nodes are already connected with that relationship.');
    edge.relationship = data.relationship;
  }
  if (data.description !== undefined) edge.description = data.description;
  await edge.save();
  await touch(project);
  await activity.record(project._id, user._id, 'edge_updated', `Changed a connection to "${edge.relationship.replace(/_/g, ' ')}"`, { edgeId: edge._id });
  return edge;
}

async function deleteEdge(project, edgeId, user) {
  const edge = await findEdge(project._id, edgeId);
  await edge.deleteOne();
  await touch(project);
  await activity.record(project._id, user._id, 'edge_deleted', 'Removed a connection from the map', { edgeId: edge._id });
}

async function touch(project) {
  await project.constructor.updateOne({ _id: project._id }, { $set: { updatedAt: new Date() } }, { timestamps: false });
}

/**
 * How a change propagates along each relationship. For an edge A -[rel]-> B:
 *  forward  = a change to A affects B
 *  backward = a change to B affects A
 */
const PROPAGATION = {
  supports: { forward: true, backward: false },
  depends_on: { forward: false, backward: true },
  blocks: { forward: true, backward: false },
  influences: { forward: true, backward: false },
  part_of: { forward: true, backward: false },
  tests: { forward: true, backward: true },
  related_to: { forward: true, backward: true, maxDepth: 1 },
  alternative_to: { forward: false, backward: false },
};

/**
 * Deterministic breadth-first impact traversal from a changed node.
 * Returns affected nodes (with depth and path) and alternative_to neighbours.
 */
function traverseImpact(nodes, edges, startId, { maxDepth = 4 } = {}) {
  const byId = new Map(nodes.map((n) => [String(n._id ?? n.id), n]));
  const start = String(startId);
  const adjacency = new Map();
  const alternatives = new Map();
  const add = (from, entry) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push(entry);
  };
  for (const e of edges) {
    const s = String(e.source);
    const t = String(e.target);
    const rule = PROPAGATION[e.relationship] || PROPAGATION.related_to;
    if (e.relationship === 'alternative_to') {
      if (s === start) alternatives.set(t, e);
      if (t === start) alternatives.set(s, e);
      continue;
    }
    if (rule.forward) add(s, { to: t, relationship: e.relationship, direction: 'forward', limit: rule.maxDepth });
    if (rule.backward) add(t, { to: s, relationship: e.relationship, direction: 'backward', limit: rule.maxDepth });
  }

  const visited = new Map([[start, { depth: 0, path: [start], via: null }]]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    const { depth, path } = visited.get(current);
    if (depth >= maxDepth) continue;
    for (const step of adjacency.get(current) || []) {
      if (visited.has(step.to) || !byId.has(step.to)) continue;
      if (step.limit && depth + 1 > step.limit) continue;
      visited.set(step.to, { depth: depth + 1, path: [...path, step.to], via: step.relationship });
      queue.push(step.to);
    }
  }

  const affected = [...visited.entries()]
    .filter(([id]) => id !== start)
    .map(([id, info]) => ({ node: byId.get(id), depth: info.depth, via: info.via, path: info.path }))
    .sort((a, b) => a.depth - b.depth);

  return {
    affected,
    alternatives: [...alternatives.keys()].filter((id) => byId.has(id)).map((id) => byId.get(id)),
  };
}

module.exports = {
  getGraph, createNode, updateNode, updatePositions, deleteNode,
  createEdge, updateEdge, deleteEdge, findNode, traverseImpact,
  serializeNode, serializeEdge, PROPAGATION,
};
