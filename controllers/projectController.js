'use strict';

const projectService = require('../services/projectService');
const graphService = require('../services/graphService');
const Task = require('../models/Task');
const { workspaceLocals } = require('./workspace');
const { wantsJson } = require('../utils/http');

function newForm(req, res) {
  res.render('projects/new', { title: 'Create an idea', values: {}, errors: {} });
}

function renderCreateErrors(req, res, errors) {
  res.status(422).render('projects/new', { title: 'Create an idea', values: req.body || {}, errors });
}

async function create(req, res) {
  const project = await projectService.createProject(req.user, req.validated);
  req.flash('success', 'Idea created. Start mapping it out: add goals, assumptions and risks.');
  res.redirect(`/projects/${project._id}/map`);
}

function open(req, res) {
  res.redirect(`/projects/${req.project._id}/map`);
}

async function map(req, res) {
  const [locals, graph, tasks] = await Promise.all([
    workspaceLocals(req, 'map'),
    graphService.getGraph(req.project._id),
    Task.find({ project: req.project._id, linkedNode: { $ne: null } }).select('title status linkedNode').lean(),
  ]);
  const linkedTasks = tasks.map((t) => ({ id: String(t._id), title: t.title, status: t.status, nodeId: String(t.linkedNode) }));
  res.render('graph/map', { ...locals, title: `${req.project.title} · Map`, graph, linkedTasks });
}

async function analysis(req, res) {
  const locals = await workspaceLocals(req, 'analysis');
  res.render('projects/analysis', { ...locals, title: `${req.project.title} · Analysis`, editing: req.query.edit === '1', errors: {} });
}

async function saveAnalysis(req, res) {
  await projectService.updateAnalysis(req.project, req.validated, req.user);
  req.flash('success', 'Analysis saved.');
  res.redirect(`/projects/${req.project._id}/analysis`);
}

async function syncAnalysis(req, res) {
  const added = await projectService.syncAnalysisFromMap(req.project, req.user);
  req.flash(added ? 'success' : 'info', added ? `Added ${added} item(s) from your map.` : 'Your analysis already includes everything on the map.');
  res.redirect(`/projects/${req.project._id}/analysis`);
}

function editForm(req, res) {
  res.render('projects/edit', { title: req.__('Edit {project}', { project: req.project.title }), values: req.project.toObject(), errors: {} });
}

function renderUpdateErrors(req, res, errors) {
  if (wantsJson(req)) return res.status(422).json({ error: 'Please correct the highlighted fields.', errors });
  return res.status(422).render('projects/edit', { title: req.__('Edit {project}', { project: req.project.title }), values: { ...req.project.toObject(), ...req.body }, errors });
}

async function update(req, res) {
  const project = await projectService.updateProject(req.project, req.validated, req.user);
  if (wantsJson(req)) {
    return res.json({ project: { id: String(project._id), title: project.title, description: project.description, stage: project.stage, status: project.status, updatedAt: project.updatedAt } });
  }
  req.flash('success', 'Project updated.');
  const back = req.body.returnTo === 'workspace' ? `/projects/${project._id}/map` : '/dashboard';
  return res.redirect(back);
}

async function destroy(req, res) {
  const title = req.project.title;
  await projectService.deleteProject(req.project);
  req.flash('success', `Deleted "${title}" and all of its maps, plans and tasks.`);
  res.redirect('/dashboard');
}

module.exports = { newForm, renderCreateErrors, create, open, map, analysis, saveAnalysis, syncAnalysis, editForm, renderUpdateErrors, update, destroy };
