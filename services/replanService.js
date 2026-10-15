'use strict';

const IdeaNode = require('../models/IdeaNode');
const IdeaEdge = require('../models/IdeaEdge');
const Task = require('../models/Task');
const graphService = require('./graphService');
const planService = require('./planService');
const proposalService = require('./proposalService');
const aiService = require('./aiService');
const logger = require('../utils/logger');
const { tr } = require('../utils/requestContext');
const { label } = require('../utils/format');

const PRIORITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

/**
 * Deterministic impact analysis for a changed assumption/decision/etc:
 * 1. graph traversal from the node, 2. tasks linked to affected nodes,
 * 3. tasks that transitively depend on those tasks, 4. milestones touched.
 */
async function analyzeImpact(project, nodeId) {
  const changed = await graphService.findNode(project._id, nodeId);
  const [nodes, edges, tasks, plan] = await Promise.all([
    IdeaNode.find({ project: project._id }).lean(),
    IdeaEdge.find({ project: project._id }).lean(),
    Task.find({ project: project._id }).lean(),
    planService.getCurrentPlan(project),
  ]);
  const { affected, alternatives } = graphService.traverseImpact(nodes, edges, changed._id);
  const nodeDepth = new Map([[String(changed._id), 0], ...affected.map((a) => [String(a.node._id), a.depth])]);
  const nodeTitle = new Map(nodes.map((n) => [String(n._id), n.title]));

  // Tasks linked to the changed node or an affected node.
  const taskImpact = new Map();
  for (const t of tasks) {
    if (t.linkedNode && nodeDepth.has(String(t.linkedNode))) {
      const depth = nodeDepth.get(String(t.linkedNode));
      taskImpact.set(String(t._id), {
        task: t, direct: depth <= 1,
        reason: depth === 0 ? `Linked to "${changed.title}"` : `Linked to "${nodeTitle.get(String(t.linkedNode))}", which is affected`,
      });
    }
  }
  // Tasks downstream through dependencies (deterministic BFS over reverse dependency edges).
  const dependents = new Map();
  for (const t of tasks) for (const d of t.dependencies) {
    const k = String(d);
    if (!dependents.has(k)) dependents.set(k, []);
    dependents.get(k).push(t);
  }
  const queue = [...taskImpact.keys()];
  while (queue.length) {
    const id = queue.shift();
    for (const dep of dependents.get(id) || []) {
      const key = String(dep._id);
      if (taskImpact.has(key)) continue;
      taskImpact.set(key, { task: dep, direct: false, reason: `Depends on "${taskImpact.get(id).task.title}"` });
      queue.push(key);
    }
  }

  const affectedTasks = [...taskImpact.values()];
  const milestoneIds = new Set(affectedTasks.map((a) => a.task.milestoneId && String(a.task.milestoneId)).filter(Boolean));
  const affectedMilestones = [];
  for (const phase of plan.phases) {
    for (const ms of phase.milestones) {
      if (milestoneIds.has(String(ms._id))) affectedMilestones.push({ id: String(ms._id), title: ms.title, phase: phase.title, completed: ms.completed });
    }
  }
  const milestoneNodes = affected.filter((a) => a.node.type === 'milestone').map((a) => a.node.title);

  return { changed: changed.toObject(), affected, alternatives, affectedTasks, affectedMilestones, milestoneNodes, nodeTitle };
}

function describeImpact(impact, changeType) {
  const { changed, affected, affectedTasks, affectedMilestones, alternatives } = impact;
  const verb = tr(changeType === 'invalidated' ? 'is no longer valid' : 'has changed');
  const open = affectedTasks.filter((a) => a.task.status !== 'completed');
  const parts = [
    tr('"{title}" ({type}) {verb}.', { title: changed.title, type: tr(label(changed.type)), verb }),
    tr('{n} other map element(s) are connected to it in ways that carry the change.', { n: affected.length }),
    tr('{n} task(s) are affected ({direct} directly), of which {open} are not yet completed.', { n: affectedTasks.length, direct: affectedTasks.filter((a) => a.direct).length, open: open.length }),
  ];
  if (affectedMilestones.length) parts.push(tr('Milestones at risk: {list}.', { list: affectedMilestones.map((m) => `"${m.title}"`).join(', ') }));
  if (alternatives.length) parts.push(tr('The map lists {n} alternative(s): {list}.', { n: alternatives.length, list: alternatives.map((a) => `"${a.title}"`).join(', ') }));
  if (!affectedTasks.length) parts.push(tr('No tasks are linked to the affected elements yet. Link tasks to map nodes to see execution impact.'));
  return parts.join(' ');
}

/** Builds a replan proposal. Nothing is changed until the user accepts it. */
async function proposeReplan(project, user, { nodeId, changeType, note, useAI }) {
  const impact = await analyzeImpact(project, nodeId);
  const { changed } = impact;
  const explanation = describeImpact(impact, changeType);

  const taskChanges = [];
  for (const a of impact.affectedTasks) {
    const t = a.task;
    if (t.status === 'completed') continue;
    const bump = PRIORITY_RANK[t.priority] < PRIORITY_RANK.high ? 'high' : undefined;
    const newStatus = a.direct && t.status !== 'blocked' ? 'blocked' : undefined;
    const newPriority = a.direct ? undefined : bump;
    if (!newStatus && !newPriority) continue;
    taskChanges.push({
      taskId: String(t._id),
      title: t.title,
      currentStatus: t.status,
      currentPriority: t.priority,
      reason: a.reason,
      direct: a.direct,
      action: a.direct ? 'block' : 'review',
      newStatus,
      newPriority,
      note: tr(changeType === 'invalidated' ? 'Waiting on replan: "{title}" was invalidated.' : 'Waiting on replan: "{title}" changed.', { title: changed.title }) + (note ? ' ' + note : ''),
      defaultSelected: a.direct,
    });
  }

  const newTasks = [];
  if (['assumption', 'risk'].includes(changed.type)) {
    newTasks.push({
      title: tr(changeType === 'invalidated' ? 'Rework plan for: {title}' : 'Re-validate: {title}', { title: changed.title }).slice(0, 200),
      description: `${tr('Follow-up created by replanning.')} ${note || ''}`.trim(),
      priority: 'high', linkedNode: String(changed._id), reason: tr('A key assumption or risk changed.'), origin: 'system', defaultSelected: true,
    });
  } else {
    newTasks.push({
      title: tr('Review plan after change: {title}', { title: changed.title }).slice(0, 200),
      description: `${tr('Follow-up created by replanning.')} ${note || ''}`.trim(),
      priority: 'high', linkedNode: String(changed._id), reason: tr('The {type} changed.', { type: tr(label(changed.type)) }), origin: 'system', defaultSelected: true,
    });
  }
  for (const alt of impact.alternatives) {
    newTasks.push({
      title: tr('Evaluate alternative: {title}', { title: alt.title }).slice(0, 200),
      description: alt.description || '',
      priority: 'medium', linkedNode: String(alt._id), reason: tr('Listed on the map as an alternative to "{title}".', { title: changed.title }), origin: 'system', defaultSelected: false,
    });
  }

  let aiNote = null;
  if (useAI) {
    try {
      const impactText = `${explanation}\nAffected tasks: ${impact.affectedTasks.map((a) => a.task.title).join('; ')}\nUser note: ${note || '-'}`;
      const { data } = await aiService.replanSuggestions(project, user, impactText);
      for (const act of data.actions) newTasks.push({ ...act, origin: 'ai', defaultSelected: false });
      aiNote = { ok: true, explanation: data.explanation };
    } catch (err) {
      logger.warn('AI replan suggestions failed', { code: err.code });
      aiNote = { ok: false, message: err.message };
    }
  }

  const nodeUpdate = changeType === 'invalidated' ? { status: 'invalidated' } : null;
  return proposalService.create(project, user, {
    kind: 'replan',
    origin: 'system',
    title: tr(changeType === 'invalidated' ? 'Replan: "{title}" invalidated' : 'Replan: "{title}" changed', { title: changed.title }).slice(0, 200),
    summary: explanation,
    payload: {
      nodeId: String(changed._id), nodeTitle: changed.title, nodeType: changed.type, changeType, note: note || '',
      nodeUpdate, explanation,
      affectedNodes: impact.affected.map((a) => ({ id: String(a.node._id), title: a.node.title, type: a.node.type, depth: a.depth, via: a.via, path: a.path.map((id) => impact.nodeTitle.get(id)) })),
      affectedMilestones: impact.affectedMilestones,
      milestoneNodes: impact.milestoneNodes,
      affectedTasks: impact.affectedTasks.map((a) => ({ id: String(a.task._id), title: a.task.title, status: a.task.status, direct: a.direct, reason: a.reason })),
      taskChanges, newTasks, ai: aiNote,
    },
  });
}

module.exports = { analyzeImpact, describeImpact, proposeReplan };
