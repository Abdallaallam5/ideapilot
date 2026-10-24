'use strict';

const IdeaNode = require('../models/IdeaNode');
const planService = require('../services/planService');
const proposalService = require('../services/proposalService');
const replanService = require('../services/replanService');
const taskService = require('../services/taskService');
const { workspaceLocals } = require('./workspace');

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

/** A plain-language review of the idea and its tasks: what is there, what is next, what needs attention. */
async function review(req, res) {
  const [locals, plan, { all: allTasks }, nodes, edges, proposals, versions] = await Promise.all([
    workspaceLocals(req, 'review'),
    planService.getCurrentPlan(req.project),
    taskService.listTasks(req.project),
    IdeaNode.find({ project: req.project._id }).select('title type').sort({ createdAt: 1 }).lean(),
    require('../models/IdeaEdge').find({ project: req.project._id }).select('source target relationship').lean(),
    proposalService.list(req.project),
    planService.listVersions(req.project),
  ]);
  const byType = (type) => nodes.filter((n) => n.type === type);
  const open = allTasks.filter((t) => t.status !== 'completed');
  const linkedNodeIds = new Set(allTasks.map((t) => String(t.linkedNode || '')));
  // A risk counts as handled when a task is linked to it or something on the map points at it.
  const handled = (n) => linkedNodeIds.has(String(n._id)) || edges.some((e) => String(e.target) === String(n._id) && e.relationship !== 'related_to');
  const phases = [...plan.phases].sort((a, b) => a.order - b.order).map((p) => {
    const tasks = allTasks.filter((t) => String(t.phaseId) === String(p._id));
    return { phase: p, progress: taskService.progress(tasks) };
  });
  const nextUp = open.filter((t) => !t.isBlocked)
    .sort((a, b) => (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || ((a.deadline ? +new Date(a.deadline) : Infinity) - (b.deadline ? +new Date(b.deadline) : Infinity)))
    .slice(0, 5);

  const checks = [];
  const looseRisks = byType('risk').filter((n) => !handled(n));
  if (looseRisks.length) checks.push({ tone: 'danger', icon: 'shield-alert', text: req.__('{n} risk(s) have no task or plan to deal with them: {list}', { n: looseRisks.length, list: looseRisks.map((n) => n.title).join('، ') }) });
  const untested = byType('assumption').filter((n) => !linkedNodeIds.has(String(n._id)));
  if (untested.length) checks.push({ tone: 'warning', icon: 'help-circle', text: req.__('{n} assumption(s) are not tested yet: {list}', { n: untested.length, list: untested.map((n) => n.title).join('، ') }) });
  const overdue = open.filter((t) => t.isOverdue);
  if (overdue.length) checks.push({ tone: 'danger', icon: 'alarm-clock', text: req.__('{n} task(s) are past their deadline.', { n: overdue.length }) });
  const blocked = open.filter((t) => t.isBlocked);
  if (blocked.length) checks.push({ tone: 'warning', icon: 'hourglass', text: req.__('{n} task(s) are waiting on other tasks or blocked.', { n: blocked.length }) });
  const emptyPhases = phases.filter((p) => !p.progress.total);
  if (emptyPhases.length) checks.push({ tone: 'info', icon: 'milestone', text: req.__('{n} phase(s) have no tasks yet: {list}', { n: emptyPhases.length, list: emptyPhases.map((p) => p.phase.title).join('، ') }) });
  if (!byType('goal').length) checks.push({ tone: 'info', icon: 'target', text: req.__('Your idea has no goal yet. Add one on the map so you know what “done” looks like.') });

  res.render('review/index', {
    ...locals,
    title: `${req.project.title} · Review`,
    plan, phases, nextUp, checks,
    progress: taskService.progress(allTasks),
    counts: {
      done: allTasks.filter((t) => t.status === 'completed').length,
      doing: allTasks.filter((t) => t.status === 'in_progress').length,
      waiting: blocked.length,
      overdue: overdue.length,
    },
    groups: [
      { type: 'goal', label: 'Goals', items: byType('goal') },
      { type: 'person', label: 'People and teams', items: byType('person') },
      { type: 'resource', label: 'What you have', items: byType('resource') },
      { type: 'risk', label: 'Risks', items: byType('risk') },
      { type: 'assumption', label: 'Assumptions', items: byType('assumption') },
    ],
    nodeCount: nodes.length,
    pending: proposals.filter((p) => p.status === 'pending'),
    versions,
  });
}

async function viewVersion(req, res) {
  const [locals, { plan, tasks }] = await Promise.all([workspaceLocals(req, 'review'), planService.getVersion(req.project, req.params.planId)]);
  const decorated = taskService.decorateTasks(tasks);
  const phases = [...plan.phases].sort((a, b) => a.order - b.order).map((p) => ({ phase: p, tasks: decorated.filter((t) => String(t.phaseId) === String(p._id)) }));
  const unphased = decorated.filter((t) => !t.phaseId || !plan.phases.some((p) => String(p._id) === String(t.phaseId)));
  res.render('history/version', { ...locals, title: `Plan version ${plan.version}`, plan, phases, unphased, progress: taskService.progress(tasks) });
}

async function restoreVersion(req, res) {
  const plan = await planService.restoreVersion(req.project, req.params.planId, req.user);
  req.flash('success', `Restored. The plan is now version ${plan.version}, copied from version ${plan.restoredFromVersion}. The replaced plan is kept under earlier versions on the Review page.`);
  res.redirect(`/projects/${req.project._id}/roadmap`);
}

async function replan(req, res) {
  const proposal = await replanService.proposeReplan(req.project, req.user, req.validated);
  if (req.get('accept')?.includes('application/json')) return res.status(201).json({ proposalUrl: `/projects/${req.project._id}/proposals/${proposal._id}` });
  return res.redirect(`/projects/${req.project._id}/proposals/${proposal._id}`);
}

async function showProposal(req, res) {
  const [locals, proposal, plan, nodes] = await Promise.all([
    workspaceLocals(req, 'review'),
    proposalService.find(req.project, req.params.proposalId),
    planService.getCurrentPlan(req.project),
    IdeaNode.find({ project: req.project._id }).select('title').lean(),
  ]);
  res.render('proposals/show', { ...locals, title: proposal.title, proposal: proposal.toObject(), phases: plan.phases, nodes });
}

async function acceptProposal(req, res) {
  const selection = new Set(req.validated.items);
  const result = await proposalService.accept(req.project, req.params.proposalId, req.user, { selection, mode: req.validated.mode });
  req.flash('success', `Applied. ${result.summary}`);
  const target = { graph: 'map', analysis: 'analysis', roadmap: 'roadmap', tasks: 'tasks', taskdraft: 'tasks', replan: 'roadmap' }[result.proposal.kind] || 'review';
  res.redirect(`/projects/${req.project._id}/${target}`);
}

async function rejectProposal(req, res) {
  await proposalService.reject(req.project, req.params.proposalId, req.user);
  req.flash('info', 'Proposal rejected. Nothing was changed.');
  res.redirect(`/projects/${req.project._id}/review`);
}

module.exports = {
  review, viewVersion, restoreVersion, replan, showProposal, acceptProposal, rejectProposal };
