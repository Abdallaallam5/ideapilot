'use strict';

const mongoose = require('mongoose');
const Proposal = require('../models/Proposal');
const IdeaNode = require('../models/IdeaNode');
const IdeaEdge = require('../models/IdeaEdge');
const Task = require('../models/Task');
const Decision = require('../models/Decision');
const AIConversation = require('../models/AIConversation');
const activity = require('./activityService');
const projectService = require('./projectService');
const planService = require('./planService');
const taskService = require('./taskService');
const { notFound, conflict, unprocessable } = require('../utils/httpError');
const { NODE_TYPES } = require('../models/constants');

async function create(project, user, { kind, origin, title, summary, payload, conversation }) {
  const proposal = await Proposal.create({ project: project._id, kind, origin, title, summary, payload, createdBy: user._id });
  if (conversation?._id) await AIConversation.updateOne({ _id: conversation._id }, { $set: { proposal: proposal._id } });
  await activity.record(project._id, user._id, 'proposal_created', `${origin === 'ai' ? 'AI proposed' : 'Proposed'}: ${title}`, { proposalId: proposal._id, kind });
  return proposal;
}

async function find(project, proposalId) {
  if (!mongoose.isValidObjectId(proposalId)) throw notFound('Proposal not found.');
  const proposal = await Proposal.findOne({ _id: proposalId, project: project._id });
  if (!proposal) throw notFound('Proposal not found.');
  return proposal;
}

async function list(project, { status } = {}) {
  const filter = { project: project._id };
  if (status) filter.status = status;
  return Proposal.find(filter).sort({ createdAt: -1 }).limit(100).lean();
}

// ---------- Builders: turn validated AI output into reviewable payloads ----------

function analysisPayload(data) {
  return { analysis: data };
}

/** Maps AI graph output to a payload, dropping edges that reference unknown nodes. */
function graphPayload(data, nodeIdByRef) {
  const keys = new Set();
  const nodes = [];
  for (const n of data.nodes) {
    if (keys.has(n.key) || !NODE_TYPES.includes(n.type)) continue;
    keys.add(n.key);
    nodes.push({ key: n.key, type: n.type, title: n.title, description: n.description || '' });
  }
  const resolve = (ref) => (keys.has(ref) ? { kind: 'new', ref } : nodeIdByRef.has(ref) ? { kind: 'existing', ref: nodeIdByRef.get(ref) } : null);
  const edges = [];
  let dropped = 0;
  for (const e of data.edges) {
    const s = resolve(e.source);
    const t = resolve(e.target);
    if (!s || !t || (s.kind === t.kind && s.ref === t.ref)) { dropped++; continue; }
    edges.push({ source: s, target: t, relationship: e.relationship, description: e.description || '' });
  }
  return { rationale: data.rationale, nodes, edges, droppedEdges: dropped };
}

/** Normalizes AI roadmap output and removes unknown or circular dependencies deterministically. */
function roadmapPayload(data) {
  const allKeys = new Set();
  const phases = data.phases.map((p) => ({
    title: p.title,
    description: p.description || '',
    milestones: p.milestones.map((m) => ({ title: m.title, description: m.description || '' })),
    tasks: p.tasks.filter((t) => !allKeys.has(t.key) && allKeys.add(t.key)).map((t) => ({ ...t })),
  }));
  const graph = new Map();
  let droppedDeps = 0;
  for (const p of phases) {
    for (const t of p.tasks) {
      const kept = [];
      for (const dep of [...new Set(t.dependsOn)]) {
        if (dep === t.key || !allKeys.has(dep) || taskService.wouldCreateCycle(graph, t.key, [dep])) {
          droppedDeps++;
          continue;
        }
        kept.push(dep);
        graph.set(t.key, kept);
      }
      t.dependsOn = kept;
    }
  }
  return { title: data.title, objective: data.objective, rationale: data.rationale, phases, droppedDeps };
}

function taskImprovementPayload(data, taskIdByRef, tasks) {
  const byId = new Map(tasks.map((t) => [String(t._id), t]));
  const improvements = [];
  for (const imp of data.improvements) {
    const taskId = taskIdByRef.get(imp.taskRef);
    const task = taskId && byId.get(taskId);
    if (!task) continue;
    const changes = {};
    if (imp.title && imp.title !== task.title) changes.title = imp.title;
    if (imp.description && imp.description !== task.description) changes.description = imp.description;
    if (imp.priority && imp.priority !== task.priority) changes.priority = imp.priority;
    if (imp.completionCriteria && imp.completionCriteria !== task.completionCriteria) changes.completionCriteria = imp.completionCriteria;
    if (!Object.keys(changes).length) continue;
    improvements.push({ taskId, currentTitle: task.title, changes, reason: imp.reason });
  }
  return { summary: data.summary, improvements, missingTasks: data.missingTasks };
}

// ---------- Accept / reject ----------

function selected(selection, prefix, index) {
  if (!selection) return true;
  return selection.has(`${prefix}:${index}`);
}

async function reject(project, proposalId, user) {
  const proposal = await find(project, proposalId);
  if (proposal.status !== 'pending') throw conflict('This proposal has already been resolved.');
  proposal.status = 'rejected';
  proposal.resolvedBy = user._id;
  proposal.resolvedAt = new Date();
  await proposal.save();
  await activity.record(project._id, user._id, 'proposal_rejected', `Rejected: ${proposal.title}`, { proposalId: proposal._id });
  return proposal;
}

/**
 * Applies the selected items of a pending proposal. `selection` is a Set of
 * item keys like "node:0" or "task:3"; when null every item is applied.
 * Changes to the plan always create a new plan version first.
 */
async function accept(project, proposalId, user, { selection = null, mode = 'append' } = {}) {
  const proposal = await find(project, proposalId);
  if (proposal.status !== 'pending') throw conflict('This proposal has already been resolved.');
  // Claim the proposal atomically so a double submit cannot apply it twice.
  const claimed = await Proposal.updateOne({ _id: proposal._id, status: 'pending' }, { $set: { status: 'accepted', resolvedBy: user._id, resolvedAt: new Date() } });
  if (!claimed.modifiedCount) throw conflict('This proposal has already been resolved.');

  try {
    const handler = APPLY[proposal.kind];
    const result = await handler(project, proposal, user, { selection, mode });
    await Proposal.updateOne({ _id: proposal._id }, { $set: { appliedSummary: result.summary, resultPlanVersion: result.planVersion } });
    await activity.record(project._id, user._id, 'proposal_accepted', `Accepted: ${proposal.title}. ${result.summary}`.slice(0, 500), { proposalId: proposal._id, planVersion: result.planVersion });
    return { proposal, ...result };
  } catch (err) {
    await Proposal.updateOne({ _id: proposal._id }, { $set: { status: 'pending' }, $unset: { resolvedBy: 1, resolvedAt: 1 } });
    throw err;
  }
}

const APPLY = {
  async analysis(project, proposal, user, { selection }) {
    const a = proposal.payload.analysis;
    const data = {};
    const sections = ['summary', ...projectService.ANALYSIS_LISTS];
    for (const s of sections) if (selected(selection, 'section', s)) data[s] = a[s];
    if (!Object.keys(data).length) throw unprocessable('Select at least one section to apply.');
    await projectService.updateAnalysis(project, data, user);
    return { summary: `Updated ${Object.keys(data).length} analysis section(s).` };
  },

  async graph(project, proposal, user, { selection }) {
    const { nodes, edges } = proposal.payload;
    const chosen = nodes.map((n, i) => ({ ...n, i })).filter((n) => selected(selection, 'node', n.i));
    const chosenEdges = edges.map((e, i) => ({ ...e, i })).filter((e) => selected(selection, 'edge', e.i));
    if (!chosen.length && !chosenEdges.length) throw unprocessable('Select at least one node or connection to add.');

    const existing = await IdeaNode.find({ project: project._id }).select('position').lean();
    const cx = existing.length ? existing.reduce((s, n) => s + n.position.x, 0) / existing.length : 0;
    const maxY = existing.length ? Math.max(...existing.map((n) => n.position.y)) : 0;
    const keyToId = new Map();
    const perRow = 4;
    for (const [idx, n] of chosen.entries()) {
      const node = await (require('./graphService')).createNode(project, {
        type: n.type, title: n.title, description: n.description,
        position: { x: Math.round(cx + ((idx % perRow) - (perRow - 1) / 2) * 220), y: Math.round(maxY + 180 + Math.floor(idx / perRow) * 150) },
      }, user, { source: 'ai', silent: true });
      keyToId.set(n.key, String(node._id));
    }
    const existingIds = new Set((await IdeaNode.find({ project: project._id }).select('_id').lean()).map((n) => String(n._id)));
    const resolve = (end) => (end.kind === 'new' ? keyToId.get(end.ref) : existingIds.has(String(end.ref)) ? String(end.ref) : null);
    let added = 0;
    for (const e of chosenEdges) {
      const source = resolve(e.source);
      const target = resolve(e.target);
      if (!source || !target || source === target) continue;
      const dup = await IdeaEdge.exists({ project: project._id, source, target, relationship: e.relationship });
      if (dup) continue;
      await IdeaEdge.create({ project: project._id, source, target, relationship: e.relationship, description: e.description });
      added++;
    }
    return { summary: `Added ${chosen.length} node(s) and ${added} connection(s) to the map.` };
  },

  async roadmap(project, proposal, user, { selection, mode }) {
    const payload = proposal.payload;
    const phases = payload.phases.map((p, i) => ({ ...p, i })).filter((p) => selected(selection, 'phase', p.i));
    if (!phases.length) throw unprocessable('Select at least one phase to apply.');
    const replace = mode === 'replace';
    const current = await planService.getCurrentPlan(project);
    const startOrder = replace ? 0 : current.phases.reduce((m, p) => Math.max(m, p.order), -1) + 1;
    const newPhases = phases.map((p, idx) => ({
      _id: new mongoose.Types.ObjectId(),
      title: p.title, description: p.description, order: startOrder + idx,
      milestones: p.milestones.map((m) => ({ _id: new mongoose.Types.ObjectId(), title: m.title, description: m.description })),
    }));
    const next = await planService.createVersion(project, user, {
      source: 'ai',
      changeSummary: `${replace ? 'Replaced the plan with' : 'Added'} an AI roadmap (${newPhases.length} phase(s)).`,
      title: replace ? payload.title : current.title,
      objective: replace ? payload.objective : current.objective,
      phases: replace ? newPhases : [...planService.clonePhases(current.phases), ...newPhases],
    });
    if (replace) await Task.deleteMany({ project: project._id });

    const keyToId = new Map();
    const docs = [];
    phases.forEach((p, idx) => {
      p.tasks.forEach((t, order) => {
        const _id = new mongoose.Types.ObjectId();
        keyToId.set(t.key, _id);
        docs.push({ _id, key: t.key, dependsOn: t.dependsOn, doc: {
          _id, project: project._id, plan: next._id, phaseId: newPhases[idx]._id, title: t.title,
          description: t.description, priority: t.priority, deliverables: t.deliverables,
          completionCriteria: t.completionCriteria, order, status: 'todo',
        } });
      });
    });
    await Task.insertMany(docs.map((d) => ({ ...d.doc, dependencies: d.dependsOn.map((k) => keyToId.get(k)).filter(Boolean) })));
    return { summary: `Created plan version ${next.version} with ${newPhases.length} phase(s) and ${docs.length} task(s).`, planVersion: next.version };
  },

  async tasks(project, proposal, user, { selection }) {
    const { improvements, missingTasks } = proposal.payload;
    const imps = improvements.map((x, i) => ({ ...x, i })).filter((x) => selected(selection, 'improve', x.i));
    const adds = missingTasks.map((x, i) => ({ ...x, i })).filter((x) => selected(selection, 'add', x.i));
    if (!imps.length && !adds.length) throw unprocessable('Select at least one suggestion to apply.');
    const next = await planService.createVersion(project, user, { source: 'ai', changeSummary: `Applied ${imps.length} AI task improvement(s) and ${adds.length} new task(s).` });
    let updated = 0;
    for (const imp of imps) {
      const res = await Task.updateOne({ _id: imp.taskId, project: project._id }, { $set: imp.changes });
      updated += res.modifiedCount;
    }
    for (const t of adds) {
      await taskService.createTask(project, { title: t.title, description: t.description, priority: t.priority }, user, { silent: true });
    }
    return { summary: `Updated ${updated} task(s) and added ${adds.length} task(s) in plan version ${next.version}.`, planVersion: next.version };
  },

  async replan(project, proposal, user, { selection }) {
    const p = proposal.payload;
    const taskChanges = p.taskChanges.map((x, i) => ({ ...x, i })).filter((x) => selected(selection, 'task', x.i));
    const newTasks = p.newTasks.map((x, i) => ({ ...x, i })).filter((x) => selected(selection, 'new', x.i));
    const applyNode = p.nodeUpdate && selected(selection, 'node', 0);
    if (!taskChanges.length && !newTasks.length && !applyNode) throw unprocessable('Select at least one change to apply.');

    const next = await planService.createVersion(project, user, {
      source: 'replan',
      changeSummary: `Replanned after "${p.nodeTitle}" ${p.changeType === 'invalidated' ? 'was invalidated' : 'changed'}.`,
    });
    if (applyNode) {
      await IdeaNode.updateOne({ _id: p.nodeId, project: project._id }, { $set: p.nodeUpdate });
    }
    for (const ch of taskChanges) {
      const set = {};
      if (ch.newStatus) set.status = ch.newStatus;
      if (ch.newStatus === 'blocked') set.blockedReason = ch.note.slice(0, 500);
      if (ch.newPriority) set.priority = ch.newPriority;
      if (ch.newStatus && ch.newStatus !== 'completed') set.completedAt = null;
      if (!Object.keys(set).length) continue;
      await Task.updateOne({ _id: ch.taskId, project: project._id }, { $set: set });
    }
    for (const t of newTasks) {
      await taskService.createTask(project, {
        title: t.title, description: t.description, priority: t.priority,
        linkedNode: t.linkedNode && (await IdeaNode.exists({ _id: t.linkedNode, project: project._id })) ? t.linkedNode : undefined,
      }, user, { silent: true });
    }
    await Decision.create({
      project: project._id,
      title: `Replan: "${p.nodeTitle}" ${p.changeType === 'invalidated' ? 'invalidated' : 'changed'}`.slice(0, 200),
      rationale: [p.note, p.explanation].filter(Boolean).join('\n\n').slice(0, 4000),
      status: 'accepted',
      relatedNode: p.nodeId,
      planVersion: next.version,
      proposal: proposal._id,
      madeBy: user._id,
    });
    return { summary: `Saved plan version ${next.version}: ${taskChanges.length} task change(s), ${newTasks.length} new task(s).`, planVersion: next.version };
  },
};

module.exports = {
  create, find, list, accept, reject,
  analysisPayload, graphPayload, roadmapPayload, taskImprovementPayload,
};
