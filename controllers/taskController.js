'use strict';

const taskService = require('../services/taskService');
const planService = require('../services/planService');
const IdeaNode = require('../models/IdeaNode');
const { workspaceLocals } = require('./workspace');
const { taskQuerySchema } = require('../validators/planValidators');
const { wantsJson } = require('../utils/http');
const { TASK_STATUSES } = require('../models/constants');

function serialize(t) {
  return {
    id: String(t._id), title: t.title, status: t.status, priority: t.priority,
    deadline: t.deadline, phaseId: t.phaseId ? String(t.phaseId) : null, order: t.order, completedAt: t.completedAt,
  };
}

async function formOptions(project) {
  const [plan, nodes, all] = await Promise.all([
    planService.getCurrentPlan(project),
    IdeaNode.find({ project: project._id }).select('title type').sort({ title: 1 }).lean(),
    taskService.listTasks(project),
  ]);
  return { plan, phases: planService.sortedPhases(plan), nodes, allTasks: all.all };
}

async function index(req, res) {
  const filters = taskQuerySchema.parse(req.query);
  const view = filters.view || req.user.settings?.defaultTaskView || 'list';
  const [locals, data, options] = await Promise.all([
    workspaceLocals(req, 'tasks'),
    taskService.listTasks(req.project, filters),
    formOptions(req.project),
  ]);
  const phaseTitle = new Map(options.phases.map((p) => [String(p._id), p.title]));
  const columns = TASK_STATUSES.map((status) => ({ status, tasks: data.tasks.filter((t) => t.status === status) }));
  const draftText = req.session.taskDraftText || '';
  delete req.session.taskDraftText;
  res.render('tasks/index', {
    ...locals, ...options, title: `${req.project.title} · Tasks`, view, filters,
    tasks: data.tasks, progress: data.progress, columns, phaseTitle,
    hasFilters: Boolean(filters.status || filters.priority || filters.phaseId || filters.q), draftText,
  });
}

async function newForm(req, res) {
  const [locals, options] = await Promise.all([workspaceLocals(req, 'tasks'), formOptions(req.project)]);
  const values = { phaseId: req.query.phaseId || '', linkedNode: req.query.nodeId || '', status: 'todo', priority: 'medium' };
  res.render('tasks/form', { ...locals, ...options, title: 'New task', task: null, values, errors: {} });
}

async function renderFormErrors(req, res, errors) {
  if (wantsJson(req)) return res.status(422).json({ error: 'Please correct the highlighted fields.', errors });
  const [locals, options] = await Promise.all([workspaceLocals(req, 'tasks'), formOptions(req.project)]);
  const task = req.params.taskId ? await taskService.findTask(req.project, req.params.taskId).catch(() => null) : null;
  const values = { ...req.body, dependencies: [].concat(req.body.dependencies || []) };
  return res.status(422).render('tasks/form', { ...locals, ...options, title: task ? 'Edit task' : 'New task', task, values, errors });
}

function redirectAfter(req, fallback) {
  const r = req.body.returnTo;
  if (r === 'roadmap') return `/projects/${req.project._id}/roadmap`;
  if (r === 'kanban') return `/projects/${req.project._id}/tasks?view=kanban`;
  if (r === 'list') return `/projects/${req.project._id}/tasks?view=list`;
  return fallback;
}

async function create(req, res) {
  try {
    const task = await taskService.createTask(req.project, req.validated, req.user);
    if (wantsJson(req)) return res.status(201).json({ task: serialize(task) });
    req.flash('success', `Created task "${task.title}".`);
    return res.redirect(redirectAfter(req, `/projects/${req.project._id}/tasks`));
  } catch (err) {
    if (!wantsJson(req) && (err.status === 422 || err.status === 409)) {
      return renderFormErrors(req, res, err.details || { _form: err.message });
    }
    throw err;
  }
}

async function editForm(req, res) {
  const task = await taskService.findTask(req.project, req.params.taskId);
  const [locals, options] = await Promise.all([workspaceLocals(req, 'tasks'), formOptions(req.project)]);
  const values = task.toObject();
  values.dependencies = task.dependencies.map(String);
  res.render('tasks/form', { ...locals, ...options, allTasks: options.allTasks.filter((t) => t.id !== String(task._id)), title: 'Edit task', task, values, errors: {} });
}

async function update(req, res) {
  try {
    const data = { ...req.validated };
    if (data.dependencies === undefined) data.dependencies = [];
    if (data.deliverables === undefined) data.deliverables = [];
    const task = await taskService.updateTask(req.project, req.params.taskId, data, req.user);
    req.flash('success', `Saved task "${task.title}".`);
    return res.redirect(redirectAfter(req, `/projects/${req.project._id}/tasks`));
  } catch (err) {
    if (err.status === 422 || err.status === 409) return renderFormErrors(req, res, err.details || { _form: err.message });
    throw err;
  }
}

/** JSON endpoint for quick changes: status, priority, deadline, phase. */
async function patch(req, res) {
  const task = await taskService.updateTask(req.project, req.params.taskId, req.validated, req.user);
  const { all, progress } = await taskService.listTasks(req.project);
  const d = all.find((t) => t.id === String(task._id));
  res.json({ task: serialize(task), progress, flags: d ? { isOverdue: d.isOverdue, waitingOn: d.waitingOn.length, isBlocked: d.isBlocked } : null });
}

async function destroy(req, res) {
  await taskService.deleteTask(req.project, req.params.taskId, req.user);
  if (wantsJson(req)) return res.json({ deleted: true });
  req.flash('success', 'Task deleted.');
  return res.redirect(redirectAfter(req, `/projects/${req.project._id}/tasks`));
}

async function reorder(req, res) {
  await taskService.reorderTasks(req.project, req.validated, req.user);
  const { progress } = await taskService.listTasks(req.project);
  res.json({ ok: true, progress });
}

module.exports = { index, newForm, renderFormErrors, create, editForm, update, patch, destroy, reorder };
