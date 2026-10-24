'use strict';

const aiService = require('../services/aiService');
const proposalService = require('../services/proposalService');
const projectService = require('../services/projectService');
const activity = require('../services/activityService');
const AIConversation = require('../models/AIConversation');
const IdeaNode = require('../models/IdeaNode');

const MAX_TITLE = 80;

/** First line of the text, cut at a word boundary, as a fallback project title. */
function titleFromText(text) {
  const first = String(text).trim().split(/\r?\n/)[0].trim();
  if (first.length <= MAX_TITLE) return first;
  const cut = first.slice(0, MAX_TITLE);
  const space = cut.lastIndexOf(' ');
  return `${(space > 30 ? cut.slice(0, space) : cut).trim()}…`;
}

function renderIdeaForm(req, res, status, { error = '', canSkipAnalysis = false } = {}) {
  res.status(status).render('projects/new', {
    title: 'Create an idea', manual: false, values: { text: req.body?.text || '' }, errors: {},
    ideaError: error, canSkipAnalysis, aiEnabled: aiService.status().enabled,
  });
}

function renderIdeaErrors(req, res, errors) {
  renderIdeaForm(req, res, 422, { error: errors.text || Object.values(errors)[0] });
}

/** Creates the project straight from the text, without analysis. */
async function createPlainProject(req, res, text) {
  const project = await projectService.createProject(req.user, { title: titleFromText(text), description: text.slice(0, 5000) });
  req.flash('success', 'Idea created. Start mapping it out: add goals, assumptions and risks.');
  return res.redirect(`/projects/${project._id}/map`);
}

/**
 * The customer describes the idea in their own words. IdeaPilot turns it into a
 * project plus a map proposal they review before anything is added to the map.
 */
async function ideaFromText(req, res) {
  const { text, plain } = req.validated;
  if (plain || !aiService.status().enabled) return createPlainProject(req, res, text);

  let result;
  try {
    result = await aiService.parseIdea(req.user, text);
  } catch (err) {
    if (err.name !== 'AIError') throw err;
    return renderIdeaForm(req, res, err.status || 502, { error: err.message, canSkipAnalysis: true });
  }
  const { data, conversation } = result;
  const project = await projectService.createProject(req.user, { title: data.title, description: data.description });
  if (conversation?._id) await AIConversation.updateOne({ _id: conversation._id }, { $set: { project: project._id } });
  const root = await IdeaNode.findOne({ project: project._id, type: 'idea' }).select('_id').lean();
  const payload = proposalService.graphPayload(data, new Map([['IDEA', String(root._id)]]), new Map([['IDEA', project.title]]));
  if (!payload.nodes.length) {
    req.flash('info', 'Idea created. IdeaPilot did not find goals, people or risks in your text, so add them on the map.');
    return res.redirect(`/projects/${project._id}/map`);
  }
  const proposal = await proposalService.create(project, req.user, {
    kind: 'graph', origin: 'ai', title: req.__('Your idea, organized by IdeaPilot'), summary: '', payload, conversation,
  });
  return res.redirect(`/projects/${project._id}/proposals/${proposal._id}`);
}

/** The customer writes their to-dos in plain words; IdeaPilot proposes structured tasks to review. */
async function tasksFromText(req, res) {
  const { text } = req.validated;
  const back = `/projects/${req.project._id}/tasks`;
  let result;
  try {
    result = await aiService.draftTasks(req.project, req.user, text);
  } catch (err) {
    if (err.name !== 'AIError') throw err;
    await activity.record(req.project._id, req.user._id, 'ai_failed', `IdeaPilot request failed: ${err.message}`.slice(0, 500), { code: err.code });
    req.session.taskDraftText = text;
    req.flash('danger', err.message);
    return res.redirect(back);
  }
  const { data, conversation, nodeIdByRef, phaseIdByRef } = result;
  const payload = proposalService.taskDraftPayload(data, { nodeIdByRef, phaseIdByRef });
  const proposal = await proposalService.create(req.project, req.user, {
    kind: 'taskdraft', origin: 'ai', title: req.__('Your tasks, organized by IdeaPilot'), summary: '', payload, conversation,
  });
  return res.redirect(`/projects/${req.project._id}/proposals/${proposal._id}`);
}

/** The customer describes their plan in plain words; IdeaPilot proposes roadmap phases to review. */
async function roadmapFromText(req, res) {
  const { text } = req.validated;
  const back = `/projects/${req.project._id}/roadmap`;
  let result;
  try {
    result = await aiService.draftRoadmap(req.project, req.user, text);
  } catch (err) {
    if (err.name !== 'AIError') throw err;
    await activity.record(req.project._id, req.user._id, 'ai_failed', `IdeaPilot request failed: ${err.message}`.slice(0, 500), { code: err.code });
    req.session.roadmapDraftText = text;
    req.flash('danger', err.message);
    return res.redirect(back);
  }
  const proposal = await proposalService.create(req.project, req.user, {
    kind: 'roadmap', origin: 'ai', title: req.__('Your roadmap, organized by IdeaPilot'), summary: '',
    payload: proposalService.roadmapPayload(result.data), conversation: result.conversation,
  });
  return res.redirect(`/projects/${req.project._id}/proposals/${proposal._id}`);
}

function renderRoadmapTextErrors(req, res, errors) {
  req.session.roadmapDraftText = req.body?.text || '';
  req.flash('danger', errors.text || Object.values(errors)[0]);
  res.redirect(`/projects/${req.project._id}/roadmap`);
}

function renderTaskTextErrors(req, res, errors) {
  req.session.taskDraftText = req.body?.text || '';
  req.flash('danger', errors.text || Object.values(errors)[0]);
  res.redirect(`/projects/${req.project._id}/tasks`);
}

module.exports = { ideaFromText, renderIdeaErrors, tasksFromText, renderTaskTextErrors, roadmapFromText, renderRoadmapTextErrors, titleFromText };
