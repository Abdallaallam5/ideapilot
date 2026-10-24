'use strict';

const express = require('express');
const ai = require('../controllers/aiController');
const { requireAuth } = require('../middleware/requireAuth');
const { requireProjectOwner } = require('../middleware/requireProjectOwner');
const { validateRequest } = require('../middleware/validateRequest');
const { createAILimiter } = require('../middleware/rateLimiter');
const { z, requiredText, checkbox } = require('../validators/common');

const ideaTextSchema = z.object({
  text: requiredText(4000, 'Your idea').refine((s) => s.length >= 10, 'Tell us a little more about your idea (at least a sentence).'),
  plain: checkbox.optional(),
});

const taskTextSchema = z.object({
  text: requiredText(4000, 'What you need to do').refine((s) => s.length >= 3, 'Write at least one thing you need to do.'),
});

module.exports = function aiRoutes(env) {
  const router = express.Router();
  const limiter = createAILimiter(env);

  router.post('/projects/from-text', requireAuth, limiter, validateRequest(ideaTextSchema, { onError: ai.renderIdeaErrors }), ai.ideaFromText);
  router.post('/projects/:projectId/tasks/from-text', requireAuth, requireProjectOwner, limiter, validateRequest(taskTextSchema, { onError: ai.renderTaskTextErrors }), ai.tasksFromText);
  return router;
};
