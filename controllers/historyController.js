'use strict';

const Decision = require('../models/Decision');
const IdeaNode = require('../models/IdeaNode');
const planService = require('../services/planService');
const proposalService = require('../services/proposalService');
const replanService = require('../services/replanService');
const activity = require('../services/activityService');
const taskService = require('../services/taskService');
const { workspaceLocals } = require('./workspace');
const { notFound } = require('../utils/httpError');
const mongoose = require('mongoose');

async function history(req, res) {
  const [locals, versions, decisions, proposals, activityPage, nodes] = await Promise.all([
    workspaceLocals(req, 'history'),
    planService.listVersions(req.project),
    Decision.find({ project: req.project._id }).sort({ createdAt: -1 }).populate('relatedNode', 'title type').lean(),
    proposalService.list(req.project),
    activity.list(req.project._id, { page: req.query.page, limit: 30 }),
    IdeaNode.find({ project: req.project._id }).select('title type').sort({ title: 1 }).lean(),
  ]);
  res.render('history/index', { ...locals, title: `${req.project.title} · History`, versions, decisions, proposals, activityPage, nodes });
}

async function viewVersion(req, res) {
  const [locals, { plan, tasks }] = await Promise.all([workspaceLocals(req, 'history'), planService.getVersion(req.project, req.params.planId)]);
  const decorated = taskService.decorateTasks(tasks);
  const phases = [...plan.phases].sort((a, b) => a.order - b.order).map((p) => ({ phase: p, tasks: decorated.filter((t) => String(t.phaseId) === String(p._id)) }));
  const unphased = decorated.filter((t) => !t.phaseId || !plan.phases.some((p) => String(p._id) === String(t.phaseId)));
  res.render('history/version', { ...locals, title: `Plan version ${plan.version}`, plan, phases, unphased, progress: taskService.progress(tasks) });
}

async function restoreVersion(req, res) {
  const plan = await planService.restoreVersion(req.project, req.params.planId, req.user);
  req.flash('success', `Restored. The plan is now version ${plan.version}, copied from version ${plan.restoredFromVersion}. The replaced plan is saved in History.`);
  res.redirect(`/projects/${req.project._id}/roadmap`);
}

async function createDecision(req, res) {
  const { relatedNode } = req.validated;
  if (relatedNode && !(await IdeaNode.exists({ _id: relatedNode, project: req.project._id }))) throw notFound('Map node not found.');
  const decision = await Decision.create({ ...req.validated, project: req.project._id, madeBy: req.user._id, planVersion: req.project.currentPlanVersion });
  await activity.record(req.project._id, req.user._id, 'decision_recorded', `Recorded decision "${decision.title}"`, { decisionId: decision._id });
  req.flash('success', 'Decision recorded.');
  res.redirect(`/projects/${req.project._id}/history#decisions`);
}

async function updateDecision(req, res) {
  if (!mongoose.isValidObjectId(req.params.decisionId)) throw notFound('Decision not found.');
  const decision = await Decision.findOneAndUpdate({ _id: req.params.decisionId, project: req.project._id }, { $set: { status: req.validated.status } }, { new: true });
  if (!decision) throw notFound('Decision not found.');
  await activity.record(req.project._id, req.user._id, 'decision_updated', `Marked decision "${decision.title}" as ${decision.status}`);
  req.flash('success', 'Decision updated.');
  res.redirect(`/projects/${req.project._id}/history#decisions`);
}

async function replan(req, res) {
  const proposal = await replanService.proposeReplan(req.project, req.user, req.validated);
  if (req.get('accept')?.includes('application/json')) return res.status(201).json({ proposalUrl: `/projects/${req.project._id}/proposals/${proposal._id}` });
  return res.redirect(`/projects/${req.project._id}/proposals/${proposal._id}`);
}

async function showProposal(req, res) {
  const [locals, proposal] = await Promise.all([workspaceLocals(req, 'history'), proposalService.find(req.project, req.params.proposalId)]);
  res.render('proposals/show', { ...locals, title: proposal.title, proposal: proposal.toObject() });
}

async function acceptProposal(req, res) {
  const selection = new Set(req.validated.items);
  const result = await proposalService.accept(req.project, req.params.proposalId, req.user, { selection, mode: req.validated.mode });
  req.flash('success', `Applied. ${result.summary}`);
  const target = { graph: 'map', analysis: 'analysis', roadmap: 'roadmap', tasks: 'tasks', replan: 'roadmap' }[result.proposal.kind] || 'history';
  res.redirect(`/projects/${req.project._id}/${target}`);
}

async function rejectProposal(req, res) {
  await proposalService.reject(req.project, req.params.proposalId, req.user);
  req.flash('info', 'Proposal rejected. Nothing was changed.');
  res.redirect(`/projects/${req.project._id}/history#proposals`);
}

module.exports = { history, viewVersion, restoreVersion, createDecision, updateDecision, replan, showProposal, acceptProposal, rejectProposal };
