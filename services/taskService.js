'use strict';

const mongoose = require('mongoose');
const Task = require('../models/Task');
const IdeaNode = require('../models/IdeaNode');
const Plan = require('../models/Plan');
const activity = require('./activityService');
const { badRequest, notFound, conflict, unprocessable } = require('../utils/httpError');
const { label } = require('../utils/format');

const MAX_TASKS_PER_PROJECT = 1000;

/**
 * Returns true when adding edges taskId -> each of depIds would create a cycle.
 * `graph` maps taskId -> array of dependency ids (what each task waits on).
 */
function wouldCreateCycle(graph, taskId, depIds) {
  const target = String(taskId);
  for (const dep of depIds) {
    const stack = [String(dep)];
    const seen = new Set();
    while (stack.length) {
      const current = stack.pop();
      if (current === target) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const next of graph.get(current) || []) stack.push(String(next));
    }
  }
  return false;
}

async function dependencyGraph(projectId) {
  const tasks = await Task.find({ project: projectId }).select('_id dependencies').lean();
  return new Map(tasks.map((t) => [String(t._id), t.dependencies.map(String)]));
}

/** Validates a dependency list for a task: same project, no self-reference, no cycles. */
async function validateDependencies(projectId, taskId, depIds) {
  const unique = [...new Set((depIds || []).map(String))];
  if (unique.some((d) => !mongoose.isValidObjectId(d))) throw unprocessable('A dependency is invalid.', { dependencies: 'Invalid task reference.' });
  if (taskId && unique.includes(String(taskId))) {
    throw unprocessable('A task cannot depend on itself.', { dependencies: 'A task cannot depend on itself.' });
  }
  if (!unique.length) return [];
  const count = await Task.countDocuments({ _id: { $in: unique }, project: projectId });
  if (count !== unique.length) throw unprocessable('Dependencies must be tasks in this project.', { dependencies: 'Unknown task.' });
  if (taskId) {
    const graph = await dependencyGraph(projectId);
    if (wouldCreateCycle(graph, taskId, unique)) {
      throw unprocessable('That dependency would create a circular chain of tasks.', { dependencies: 'That dependency would create a circular chain of tasks.' });
    }
  }
  return unique;
}

async function validatePlacement(project, plan, { phaseId, milestoneId, linkedNode }) {
  const out = { phaseId: null, milestoneId: null, linkedNode: null };
  if (phaseId) {
    const phase = plan.phases.id(phaseId);
    if (!phase) throw unprocessable('That phase does not exist in the current plan.', { phaseId: 'Unknown phase.' });
    out.phaseId = phase._id;
    if (milestoneId) {
      const ms = phase.milestones.id(milestoneId);
      if (!ms) throw unprocessable('That milestone is not part of the selected phase.', { milestoneId: 'Unknown milestone.' });
      out.milestoneId = ms._id;
    }
  } else if (milestoneId) {
    throw unprocessable('Choose a phase before choosing a milestone.', { milestoneId: 'Choose a phase first.' });
  }
  if (linkedNode) {
    const exists = await IdeaNode.exists({ _id: linkedNode, project: project._id });
    if (!exists) throw unprocessable('The linked map node does not exist in this project.', { linkedNode: 'Unknown node.' });
    out.linkedNode = linkedNode;
  }
  return out;
}

async function currentPlan(project) {
  const plan = await Plan.findOne({ _id: project.currentPlan, project: project._id });
  if (!plan) throw notFound('The current plan could not be found.');
  return plan;
}

async function findTask(project, taskId) {
  if (!mongoose.isValidObjectId(taskId)) throw notFound('Task not found.');
  const task = await Task.findOne({ _id: taskId, project: project._id });
  if (!task) throw notFound('Task not found.');
  return task;
}

async function createTask(project, data, user, { silent = false } = {}) {
  const total = await Task.countDocuments({ project: project._id });
  if (total >= MAX_TASKS_PER_PROJECT) throw conflict(`A project can hold at most ${MAX_TASKS_PER_PROJECT} tasks.`);
  const plan = await currentPlan(project);
  const placement = await validatePlacement(project, plan, data);
  const dependencies = await validateDependencies(project._id, null, data.dependencies);
  if (data.status === 'completed') await assertDependenciesComplete({ dependencies });
  const last = await Task.findOne({ project: project._id, phaseId: placement.phaseId }).sort({ order: -1 }).select('order').lean();
  const task = await Task.create({
    project: project._id,
    plan: plan._id,
    ...placement,
    title: data.title,
    description: data.description || '',
    status: data.status || 'todo',
    priority: data.priority || 'medium',
    dependencies,
    deliverables: data.deliverables || [],
    completionCriteria: data.completionCriteria || '',
    deadline: data.deadline || null,
    blockedReason: data.blockedReason || '',
    order: (last?.order ?? -1) + 1,
  });
  await touch(project);
  if (!silent) await activity.record(project._id, user._id, 'task_created', `Created task "${task.title}"`, { taskId: task._id });
  return task;
}

async function assertDependenciesComplete(task) {
  if (!task.dependencies.length) return;
  const open = await Task.find({ _id: { $in: task.dependencies }, status: { $ne: 'completed' } }).select('title').lean();
  if (open.length) {
    throw conflict(`This task is waiting on ${open.length} unfinished task(s): ${open.map((t) => `"${t.title}"`).join(', ')}. Complete them first.`);
  }
}

const UPDATABLE = ['title', 'description', 'status', 'priority', 'deliverables', 'completionCriteria', 'deadline', 'blockedReason'];

async function updateTask(project, taskId, data, user) {
  const task = await findTask(project, taskId);
  const plan = await currentPlan(project);
  const before = { status: task.status, title: task.title };

  if (data.phaseId !== undefined || data.milestoneId !== undefined || data.linkedNode !== undefined) {
    const placement = await validatePlacement(project, plan, {
      phaseId: data.phaseId !== undefined ? data.phaseId : task.phaseId,
      milestoneId: data.milestoneId !== undefined ? data.milestoneId : data.phaseId !== undefined ? null : task.milestoneId,
      linkedNode: data.linkedNode !== undefined ? data.linkedNode : task.linkedNode,
    });
    Object.assign(task, placement);
  }
  if (data.dependencies !== undefined) {
    task.dependencies = await validateDependencies(project._id, task._id, data.dependencies);
  }
  for (const key of UPDATABLE) if (data[key] !== undefined) task[key] = data[key];
  if (task.status !== 'blocked' && data.blockedReason === undefined) task.blockedReason = '';
  if (task.status === 'completed' && before.status !== 'completed') await assertDependenciesComplete(task);

  await task.save();
  await touch(project);
  if (before.status !== task.status) {
    await activity.record(project._id, user._id, 'task_status_changed', `Moved "${task.title}" from ${label(before.status)} to ${label(task.status)}`, { taskId: task._id, from: before.status, to: task.status });
  } else {
    await activity.record(project._id, user._id, 'task_updated', `Updated task "${task.title}"`, { taskId: task._id });
  }
  return task;
}

async function deleteTask(project, taskId, user) {
  const task = await findTask(project, taskId);
  await Task.updateMany({ project: project._id, dependencies: task._id }, { $pull: { dependencies: task._id } });
  await task.deleteOne();
  await touch(project);
  await activity.record(project._id, user._id, 'task_deleted', `Deleted task "${task.title}"`);
}

/** Persists a new ordering (and optionally a new phase or status) for a group of tasks. */
async function reorderTasks(project, { orderedIds, phaseId, status }, user) {
  const ids = [...new Set(orderedIds.map(String))];
  const tasks = await Task.find({ _id: { $in: ids }, project: project._id });
  if (tasks.length !== ids.length) throw badRequest('Some tasks do not belong to this project.');
  let plan;
  if (phaseId !== undefined && phaseId !== null) {
    plan = await currentPlan(project);
    if (!plan.phases.id(phaseId)) throw unprocessable('That phase does not exist.');
  }
  const byId = new Map(tasks.map((t) => [String(t._id), t]));
  for (const [index, id] of ids.entries()) {
    const task = byId.get(id);
    task.order = index;
    if (phaseId !== undefined && String(task.phaseId || '') !== String(phaseId || '')) {
      task.phaseId = phaseId || null;
      task.milestoneId = null;
    }
    if (status && task.status !== status) {
      if (status === 'completed') await assertDependenciesComplete(task);
      const from = task.status;
      task.status = status;
      if (status !== 'blocked') task.blockedReason = '';
      await activity.record(project._id, user._id, 'task_status_changed', `Moved "${task.title}" from ${label(from)} to ${label(status)}`, { taskId: task._id, from, to: status });
    }
  }
  await Promise.all(tasks.map((t) => t.save()));
  await touch(project);
  return tasks;
}

const STATUS_ORDER = { todo: 0, in_progress: 1, blocked: 2, completed: 3 };

/** Adds computed flags (overdue, waiting on dependencies) to plain task objects. */
function decorateTasks(tasks, now = new Date()) {
  const byId = new Map(tasks.map((t) => [String(t._id), t]));
  return tasks.map((t) => {
    const deps = (t.dependencies || []).map((d) => byId.get(String(d))).filter(Boolean);
    const waitingOn = deps.filter((d) => d.status !== 'completed');
    const dependents = tasks.filter((o) => (o.dependencies || []).some((d) => String(d) === String(t._id)));
    return {
      ...t,
      id: String(t._id),
      dependencyTasks: deps.map((d) => ({ id: String(d._id), title: d.title, status: d.status })),
      waitingOn: waitingOn.map((d) => ({ id: String(d._id), title: d.title })),
      dependents: dependents.map((d) => ({ id: String(d._id), title: d.title })),
      isOverdue: Boolean(t.deadline && t.status !== 'completed' && new Date(t.deadline) < startOfDay(now)),
      isBlocked: t.status === 'blocked' || (waitingOn.length > 0 && t.status !== 'completed'),
    };
  });
}

function startOfDay(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function progress(tasks) {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === 'completed').length;
  return { total, completed, percent: total ? Math.round((completed / total) * 100) : 0 };
}

async function listTasks(project, { status, priority, phaseId, q, sort } = {}) {
  const all = await Task.find({ project: project._id }).sort({ order: 1, createdAt: 1 }).lean();
  let tasks = decorateTasks(all);
  if (status === 'overdue') tasks = tasks.filter((t) => t.isOverdue);
  else if (status) tasks = tasks.filter((t) => t.status === status);
  if (priority) tasks = tasks.filter((t) => t.priority === priority);
  if (phaseId === 'none') tasks = tasks.filter((t) => !t.phaseId);
  else if (phaseId) tasks = tasks.filter((t) => String(t.phaseId) === String(phaseId));
  if (q) {
    const needle = q.toLowerCase();
    tasks = tasks.filter((t) => t.title.toLowerCase().includes(needle) || (t.description || '').toLowerCase().includes(needle));
  }
  const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
  if (sort === 'deadline') tasks.sort((a, b) => (a.deadline ? new Date(a.deadline) : Infinity) - (b.deadline ? new Date(b.deadline) : Infinity));
  else if (sort === 'priority') tasks.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  else if (sort === 'status') tasks.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  return { tasks, all: decorateTasks(all), progress: progress(all) };
}

async function touch(project) {
  await project.constructor.updateOne({ _id: project._id }, { $set: { updatedAt: new Date() } }, { timestamps: false });
}

module.exports = {
  createTask, updateTask, deleteTask, reorderTasks, listTasks, findTask,
  validateDependencies, wouldCreateCycle, decorateTasks, progress, assertDependenciesComplete,
};
