'use strict';

const mongoose = require('mongoose');
const Plan = require('../models/Plan');
const Task = require('../models/Task');
const IdeaNode = require('../models/IdeaNode');
const Project = require('../models/Project');
const activity = require('./activityService');
const { notFound, unprocessable, conflict } = require('../utils/httpError');

const MAX_PHASES = 30;
const MAX_MILESTONES_PER_PHASE = 20;

/** Loads the project's current plan, repairing the pointer if it is missing. */
async function getCurrentPlan(project) {
  let plan = project.currentPlan ? await Plan.findOne({ _id: project.currentPlan, project: project._id }) : null;
  if (!plan) {
    plan = await Plan.findOne({ project: project._id, status: 'current' }).sort({ version: -1 });
  }
  if (!plan) {
    const latest = await Plan.findOne({ project: project._id }).sort({ version: -1 }).select('version').lean();
    plan = await Plan.create({
      project: project._id, version: (latest?.version || 0) + 1, title: `${project.title} plan`.slice(0, 140),
      objective: project.desiredOutcome || '', source: 'initial', createdBy: project.owner,
    });
  }
  if (!project.currentPlan || !project.currentPlan.equals(plan._id)) {
    project.currentPlan = plan._id;
    project.currentPlanVersion = plan.version;
    await Project.updateOne({ _id: project._id }, { $set: { currentPlan: plan._id, currentPlanVersion: plan.version } });
  }
  return plan;
}

function sortedPhases(plan) {
  return [...plan.phases].sort((a, b) => a.order - b.order);
}

async function updatePlanMeta(project, data, user) {
  const plan = await getCurrentPlan(project);
  if (data.title !== undefined) plan.title = data.title;
  if (data.objective !== undefined) plan.objective = data.objective;
  await plan.save();
  await activity.record(project._id, user._id, 'plan_updated', 'Updated the plan title and objective');
  return plan;
}

async function addPhase(project, data, user) {
  const plan = await getCurrentPlan(project);
  if (plan.phases.length >= MAX_PHASES) throw conflict(`A plan can have at most ${MAX_PHASES} phases.`);
  const maxOrder = plan.phases.reduce((m, p) => Math.max(m, p.order), -1);
  plan.phases.push({ title: data.title, description: data.description || '', order: maxOrder + 1 });
  await plan.save();
  await activity.record(project._id, user._id, 'phase_created', `Added phase "${data.title}"`);
  return plan;
}

function findPhase(plan, phaseId) {
  const phase = mongoose.isValidObjectId(phaseId) ? plan.phases.id(phaseId) : null;
  if (!phase) throw notFound('Phase not found.');
  return phase;
}

async function updatePhase(project, phaseId, data, user) {
  const plan = await getCurrentPlan(project);
  const phase = findPhase(plan, phaseId);
  if (data.title !== undefined) phase.title = data.title;
  if (data.description !== undefined) phase.description = data.description;
  await plan.save();
  await activity.record(project._id, user._id, 'phase_updated', `Updated phase "${phase.title}"`);
  return plan;
}

/** Deletes a phase; its tasks are kept and moved to "Unphased" so no work is lost. */
async function deletePhase(project, phaseId, user) {
  const plan = await getCurrentPlan(project);
  const phase = findPhase(plan, phaseId);
  const moved = await Task.updateMany({ project: project._id, phaseId: phase._id }, { $set: { phaseId: null, milestoneId: null } });
  const title = phase.title;
  phase.deleteOne();
  await plan.save();
  await activity.record(project._id, user._id, 'phase_deleted', `Deleted phase "${title}" (${moved.modifiedCount} task(s) moved to Unphased)`);
  return plan;
}

async function reorderPhases(project, orderedIds, user) {
  const plan = await getCurrentPlan(project);
  const ids = orderedIds.map(String);
  if (ids.length !== plan.phases.length || !plan.phases.every((p) => ids.includes(String(p._id)))) {
    throw unprocessable('The phase order must list every phase exactly once.');
  }
  for (const phase of plan.phases) phase.order = ids.indexOf(String(phase._id));
  await plan.save();
  await activity.record(project._id, user._id, 'phase_updated', 'Reordered plan phases');
  return plan;
}

async function movePhase(project, phaseId, direction, user) {
  const plan = await getCurrentPlan(project);
  const phases = sortedPhases(plan);
  const index = phases.findIndex((p) => String(p._id) === String(phaseId));
  if (index === -1) throw notFound('Phase not found.');
  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= phases.length) return plan;
  [phases[index], phases[swapWith]] = [phases[swapWith], phases[index]];
  return reorderPhases(project, phases.map((p) => p._id), user);
}

async function addMilestone(project, phaseId, data, user) {
  const plan = await getCurrentPlan(project);
  const phase = findPhase(plan, phaseId);
  if (phase.milestones.length >= MAX_MILESTONES_PER_PHASE) throw conflict('This phase already has the maximum number of milestones.');
  phase.milestones.push({ title: data.title, description: data.description || '', dueDate: data.dueDate || null });
  await plan.save();
  await activity.record(project._id, user._id, 'milestone_updated', `Added milestone "${data.title}" to "${phase.title}"`);
  return plan;
}

function findMilestone(plan, phaseId, milestoneId) {
  const phase = findPhase(plan, phaseId);
  const ms = mongoose.isValidObjectId(milestoneId) ? phase.milestones.id(milestoneId) : null;
  if (!ms) throw notFound('Milestone not found.');
  return { phase, ms };
}

async function updateMilestone(project, phaseId, milestoneId, data, user) {
  const plan = await getCurrentPlan(project);
  const { ms } = findMilestone(plan, phaseId, milestoneId);
  if (data.title !== undefined) ms.title = data.title;
  if (data.description !== undefined) ms.description = data.description;
  if (data.dueDate !== undefined) ms.dueDate = data.dueDate;
  if (data.completed !== undefined && data.completed !== ms.completed) {
    ms.completed = data.completed;
    ms.completedAt = data.completed ? new Date() : null;
  }
  await plan.save();
  await activity.record(project._id, user._id, 'milestone_updated', `${data.completed === true ? 'Completed' : 'Updated'} milestone "${ms.title}"`);
  return plan;
}

async function deleteMilestone(project, phaseId, milestoneId, user) {
  const plan = await getCurrentPlan(project);
  const { ms } = findMilestone(plan, phaseId, milestoneId);
  await Task.updateMany({ project: project._id, milestoneId: ms._id }, { $set: { milestoneId: null } });
  const title = ms.title;
  ms.deleteOne();
  await plan.save();
  await activity.record(project._id, user._id, 'milestone_updated', `Deleted milestone "${title}"`);
  return plan;
}

function snapshotTask(t) {
  return {
    taskId: t._id, phaseId: t.phaseId, milestoneId: t.milestoneId, linkedNode: t.linkedNode,
    title: t.title, description: t.description, status: t.status, priority: t.priority,
    dependencies: t.dependencies, deliverables: t.deliverables, completionCriteria: t.completionCriteria,
    deadline: t.deadline, completedAt: t.completedAt, order: t.order,
  };
}

function clonePhases(phases) {
  return phases.map((p) => ({
    _id: p._id, title: p.title, description: p.description, order: p.order,
    milestones: (p.milestones || []).map((m) => ({ _id: m._id, title: m.title, description: m.description, dueDate: m.dueDate, completed: m.completed, completedAt: m.completedAt })),
  }));
}

/**
 * Archives the current plan (freezing a snapshot of every task) and starts a
 * new current version. Callers apply their changes AFTER this returns, so the
 * archived version always holds the pre-change state and can be restored.
 */
async function createVersion(project, user, { source = 'manual', changeSummary = '', title, objective, phases } = {}) {
  const current = await getCurrentPlan(project);
  const tasks = await Task.find({ project: project._id }).lean();

  const next = new Plan({
    project: project._id,
    version: current.version + 1,
    title: title ?? current.title,
    objective: objective ?? current.objective,
    phases: phases ?? clonePhases(current.phases),
    status: 'current',
    source,
    changeSummary: changeSummary || 'New plan version.',
    createdBy: user._id,
  });

  current.tasksSnapshot = tasks.map(snapshotTask);
  current.status = 'archived';
  current.archivedAt = new Date();
  await current.save();
  try {
    await next.save();
  } catch (err) {
    current.status = 'current';
    current.archivedAt = undefined;
    await current.save();
    throw err;
  }
  await Task.updateMany({ project: project._id }, { $set: { plan: next._id } });
  project.currentPlan = next._id;
  project.currentPlanVersion = next.version;
  await Project.updateOne({ _id: project._id }, { $set: { currentPlan: next._id, currentPlanVersion: next.version, updatedAt: new Date() } });
  await activity.record(project._id, user._id, 'plan_version_created', `Saved plan version ${next.version}: ${next.changeSummary}`.slice(0, 500), { version: next.version, source });
  return next;
}

async function listVersions(project) {
  const plans = await Plan.find({ project: project._id }).sort({ version: -1 }).populate('createdBy', 'name').lean();
  const liveCount = await Task.countDocuments({ project: project._id });
  return plans.map((p) => ({
    ...p,
    phaseCount: p.phases.length,
    taskCount: p.status === 'current' ? liveCount : p.tasksSnapshot.length,
    completedCount: p.status === 'current' ? null : p.tasksSnapshot.filter((t) => t.status === 'completed').length,
  }));
}

async function getVersion(project, planId) {
  if (!mongoose.isValidObjectId(planId)) throw notFound('Plan version not found.');
  const plan = await Plan.findOne({ _id: planId, project: project._id }).populate('createdBy', 'name').lean();
  if (!plan) throw notFound('Plan version not found.');
  const tasks = plan.status === 'current'
    ? await Task.find({ project: project._id }).sort({ order: 1 }).lean()
    : plan.tasksSnapshot.map((t) => ({ ...t, _id: t.taskId }));
  return { plan, tasks };
}

/**
 * Restores an archived version by creating a NEW version with its content.
 * The plan being replaced is archived first, so restoring is itself reversible.
 */
async function restoreVersion(project, planId, user) {
  if (!mongoose.isValidObjectId(planId)) throw notFound('Plan version not found.');
  const source = await Plan.findOne({ _id: planId, project: project._id }).lean();
  if (!source) throw notFound('Plan version not found.');
  if (source.status === 'current') throw conflict('This version is already the current plan.');

  const next = await createVersion(project, user, {
    source: 'restore',
    changeSummary: `Restored from version ${source.version}.`,
    title: source.title,
    objective: source.objective,
    phases: clonePhases(source.phases),
  });
  next.restoredFromVersion = source.version;
  await next.save();

  const nodeIds = new Set((await IdeaNode.find({ project: project._id }).select('_id').lean()).map((n) => String(n._id)));
  const snapshotIds = new Set(source.tasksSnapshot.map((t) => String(t.taskId)));
  await Task.deleteMany({ project: project._id });
  if (source.tasksSnapshot.length) {
    await Task.insertMany(
      source.tasksSnapshot.map((t) => ({
        _id: t.taskId,
        project: project._id,
        plan: next._id,
        phaseId: t.phaseId || null,
        milestoneId: t.milestoneId || null,
        linkedNode: t.linkedNode && nodeIds.has(String(t.linkedNode)) ? t.linkedNode : null,
        title: t.title,
        description: t.description || '',
        status: t.status || 'todo',
        priority: t.priority || 'medium',
        dependencies: (t.dependencies || []).filter((d) => snapshotIds.has(String(d))),
        deliverables: t.deliverables || [],
        completionCriteria: t.completionCriteria || '',
        deadline: t.deadline || null,
        completedAt: t.completedAt || null,
        order: t.order || 0,
      }))
    );
  }
  await activity.record(project._id, user._id, 'plan_restored', `Restored plan version ${source.version} as version ${next.version}`, { from: source.version, to: next.version });
  return next;
}

module.exports = {
  getCurrentPlan, sortedPhases, updatePlanMeta, addPhase, updatePhase, deletePhase, reorderPhases, movePhase,
  addMilestone, updateMilestone, deleteMilestone, createVersion, listVersions, getVersion, restoreVersion, clonePhases,
};
