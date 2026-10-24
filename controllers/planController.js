'use strict';

const planService = require('../services/planService');
const taskService = require('../services/taskService');
const IdeaNode = require('../models/IdeaNode');
const { workspaceLocals } = require('./workspace');
const { wantsJson } = require('../utils/http');

const back = (req, hash = '') => `/projects/${req.project._id}/roadmap${hash}`;

async function roadmap(req, res) {
  const [locals, plan, taskData, nodes] = await Promise.all([
    workspaceLocals(req, 'roadmap'),
    planService.getCurrentPlan(req.project),
    taskService.listTasks(req.project),
    IdeaNode.find({ project: req.project._id }).select('title type').sort({ title: 1 }).lean(),
  ]);
  const phases = planService.sortedPhases(plan).map((p) => {
    const tasks = taskData.all.filter((t) => String(t.phaseId) === String(p._id));
    return { phase: p, tasks, progress: taskService.progress(tasks) };
  });
  const unphased = taskData.all.filter((t) => !t.phaseId || !plan.phases.id(t.phaseId));
  const draftText = req.session.roadmapDraftText || '';
  delete req.session.roadmapDraftText;
  res.render('plans/roadmap', {
    ...locals, title: `${req.project.title} · Roadmap`, plan, phases, unphased, draftText,
    allTasks: taskData.all, progress: taskData.progress, nodes,
  });
}

async function updateMeta(req, res) {
  await planService.updatePlanMeta(req.project, req.validated, req.user);
  req.flash('success', 'Plan details saved.');
  res.redirect(back(req));
}

async function addPhase(req, res) {
  const plan = await planService.addPhase(req.project, req.validated, req.user);
  const phase = plan.phases[plan.phases.length - 1];
  req.flash('success', `Added phase "${phase.title}".`);
  res.redirect(back(req, `#phase-${phase._id}`));
}

async function updatePhase(req, res) {
  await planService.updatePhase(req.project, req.params.phaseId, req.validated, req.user);
  req.flash('success', 'Phase updated.');
  res.redirect(back(req, `#phase-${req.params.phaseId}`));
}

async function deletePhase(req, res) {
  await planService.deletePhase(req.project, req.params.phaseId, req.user);
  req.flash('success', 'Phase deleted. Its tasks were moved to Unphased.');
  res.redirect(back(req));
}

async function movePhase(req, res) {
  await planService.movePhase(req.project, req.params.phaseId, req.validated.direction, req.user);
  res.redirect(back(req, `#phase-${req.params.phaseId}`));
}

async function reorderPhases(req, res) {
  await planService.reorderPhases(req.project, req.validated.orderedIds, req.user);
  res.json({ ok: true });
}

async function addMilestone(req, res) {
  await planService.addMilestone(req.project, req.params.phaseId, req.validated, req.user);
  req.flash('success', 'Milestone added.');
  res.redirect(back(req, `#phase-${req.params.phaseId}`));
}

async function updateMilestone(req, res) {
  await planService.updateMilestone(req.project, req.params.phaseId, req.params.milestoneId, req.validated, req.user);
  if (wantsJson(req)) return res.json({ ok: true });
  req.flash('success', 'Milestone updated.');
  return res.redirect(back(req, `#phase-${req.params.phaseId}`));
}

async function deleteMilestone(req, res) {
  await planService.deleteMilestone(req.project, req.params.phaseId, req.params.milestoneId, req.user);
  req.flash('success', 'Milestone deleted.');
  res.redirect(back(req, `#phase-${req.params.phaseId}`));
}

async function saveVersion(req, res) {
  const plan = await planService.createVersion(req.project, req.user, { source: 'manual', changeSummary: req.validated.changeSummary });
  req.flash('success', `Saved. You are now editing plan version ${plan.version}; version ${plan.version - 1} is kept in History.`);
  res.redirect(req.body.returnTo === 'review' ? `/projects/${req.project._id}/review` : back(req));
}

module.exports = { roadmap, updateMeta, addPhase, updatePhase, deletePhase, movePhase, reorderPhases, addMilestone, updateMilestone, deleteMilestone, saveVersion };
