'use strict';

const aiService = require('../services/aiService');
const proposalService = require('../services/proposalService');
const activity = require('../services/activityService');
const { wantsJson } = require('../utils/http');

function proposalUrl(req, proposal) {
  return `/projects/${req.project._id}/proposals/${proposal._id}`;
}

function respond(req, res, proposal) {
  const url = proposalUrl(req, proposal);
  if (wantsJson(req)) return res.status(201).json({ proposalUrl: url, proposalId: String(proposal._id) });
  return res.redirect(url);
}

/** Wraps an AI action so provider failures become clear messages and are never reported as success. */
function handle(action) {
  return async (req, res) => {
    try {
      return await action(req, res);
    } catch (err) {
      if (err.name !== 'AIError') throw err;
      await activity.record(req.project._id, req.user._id, 'ai_failed', `AI request failed: ${err.message}`.slice(0, 500), { code: err.code });
      if (wantsJson(req)) return res.status(err.status || 502).json({ error: err.message, code: err.code });
      req.flash('danger', err.message);
      return res.redirect(req.get('referer') || `/projects/${req.project._id}/map`);
    }
  };
}

function status(req, res) {
  res.json(aiService.status());
}

const analyze = handle(async (req, res) => {
  const { data, conversation } = await aiService.analyzeIdea(req.project, req.user);
  const proposal = await proposalService.create(req.project, req.user, {
    kind: 'analysis', origin: 'ai', title: req.__('AI analysis of the idea'), summary: data.summary,
    payload: proposalService.analysisPayload(data), conversation,
  });
  return respond(req, res, proposal);
});

const FOCUS_TITLES = { components: 'Suggested missing components', risks: 'Suggested risks and assumptions', full: 'Proposed idea map', alternatives: 'Suggested alternative approaches' };

const graph = handle(async (req, res) => {
  const focus = ['components', 'risks', 'full', 'alternatives'].includes(req.body.focus) ? req.body.focus : 'components';
  const { data, conversation, nodeIdByRef } = await aiService.suggestGraph(req.project, req.user, { focus });
  const payload = proposalService.graphPayload(data, nodeIdByRef);
  const proposal = await proposalService.create(req.project, req.user, {
    kind: 'graph', origin: 'ai', title: req.__(FOCUS_TITLES[focus]), summary: data.rationale, payload, conversation,
  });
  return respond(req, res, proposal);
});

const roadmap = handle(async (req, res) => {
  const { data, conversation } = await aiService.generateRoadmap(req.project, req.user);
  const payload = proposalService.roadmapPayload(data);
  const proposal = await proposalService.create(req.project, req.user, {
    kind: 'roadmap', origin: 'ai', title: req.__('AI roadmap: {title}', { title: data.title }).slice(0, 200), summary: data.rationale, payload, conversation,
  });
  return respond(req, res, proposal);
});

const tasks = handle(async (req, res) => {
  const { data, conversation, taskIdByRef } = await aiService.improveTasks(req.project, req.user);
  const ctxTasks = await require('../models/Task').find({ project: req.project._id }).lean();
  const payload = proposalService.taskImprovementPayload(data, taskIdByRef, ctxTasks);
  const proposal = await proposalService.create(req.project, req.user, {
    kind: 'tasks', origin: 'ai', title: req.__('AI task improvements'), summary: data.summary, payload, conversation,
  });
  return respond(req, res, proposal);
});

const chat = handle(async (req, res) => {
  const { data, conversation } = await aiService.chat(req.project, req.user, req.validated);
  res.json({ answer: data.answer, followUps: data.followUps, conversationId: String(conversation?._id || '') });
});

async function conversations(req, res) {
  const items = await aiService.recentConversations(req.project, 10);
  res.json({
    items: items.map((c) => {
      let answer = '';
      try { answer = JSON.parse(c.response || '{}').answer || ''; } catch { answer = ''; }
      return { id: String(c._id), prompt: c.prompt, answer, status: c.status, error: c.error, createdAt: c.createdAt };
    }),
  });
}

module.exports = { status, analyze, graph, roadmap, tasks, chat, conversations };
