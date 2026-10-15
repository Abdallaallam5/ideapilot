'use strict';

const express = require('express');
const ai = require('../controllers/aiController');
const { requireAuth } = require('../middleware/requireAuth');
const { requireProjectOwner } = require('../middleware/requireProjectOwner');
const { validateRequest } = require('../middleware/validateRequest');
const { createAILimiter } = require('../middleware/rateLimiter');
const { z, requiredText } = require('../validators/common');

const chatSchema = z.object({
  question: requiredText(2000, 'Question'),
  mode: z.enum(['ask', 'explain', 'alternatives']).default('ask'),
});

module.exports = function aiRoutes(env) {
  const router = express.Router();
  const limiter = createAILimiter(env);
  const owner = [requireAuth, requireProjectOwner];
  const base = '/projects/:projectId/ai';

  router.get(`${base}/status`, owner, ai.status);
  router.get(`${base}/conversations`, owner, ai.conversations);
  router.post(`${base}/analyze`, owner, limiter, ai.analyze);
  router.post(`${base}/graph`, owner, limiter, ai.graph);
  router.post(`${base}/roadmap`, owner, limiter, ai.roadmap);
  router.post(`${base}/tasks`, owner, limiter, ai.tasks);
  router.post(`${base}/chat`, owner, limiter, validateRequest(chatSchema), ai.chat);
  return router;
};
