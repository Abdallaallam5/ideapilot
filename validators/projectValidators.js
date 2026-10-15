'use strict';

const { z, requiredText, optionalText, linesList } = require('./common');
const { PROJECT_STAGES, PROJECT_STATUSES } = require('../models/constants');

const projectFields = {
  title: requiredText(140, 'Title'),
  description: requiredText(5000, 'Description'),
  desiredOutcome: optionalText(2000),
  targetAudience: optionalText(1000),
  budget: optionalText(200),
  availableTime: optionalText(200),
  skillsResources: optionalText(2000),
  constraints: optionalText(2000),
};

const createProjectSchema = z.object(projectFields);

const updateProjectSchema = z.object({
  ...Object.fromEntries(Object.entries(projectFields).map(([k, v]) => [k, v.optional()])),
  stage: z.enum(PROJECT_STAGES).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
});

const dashboardQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  stage: z.enum(PROJECT_STAGES).optional().catch(undefined),
  status: z.enum(PROJECT_STATUSES).optional().catch(undefined),
  sort: z.enum(['updated', 'created', 'title']).optional().catch(undefined),
});

const analysisSchema = z.object({
  summary: optionalText(5000),
  goals: linesList(),
  coreComponents: linesList(),
  assumptions: linesList(),
  risks: linesList(),
  unknowns: linesList(),
  opportunities: linesList(),
  nextSteps: linesList(),
});

module.exports = { createProjectSchema, updateProjectSchema, dashboardQuerySchema, analysisSchema };
