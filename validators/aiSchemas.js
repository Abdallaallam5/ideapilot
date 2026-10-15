'use strict';

const { z } = require('zod');
const { NODE_TYPES, RELATIONSHIP_TYPES, PRIORITIES } = require('../models/constants');

// Schemas for model output. Every AI response is validated against one of
// these before it can become a proposal; anything else is rejected.
const str = (max) => z.string().trim().min(1).max(max);
const list = (maxItems, maxLen = 300) => z.array(str(maxLen)).max(maxItems);

const analysisOutput = z.object({
  summary: str(2000),
  goals: list(10),
  coreComponents: list(12),
  assumptions: list(12),
  risks: list(12),
  unknowns: list(10),
  opportunities: list(10),
  nextSteps: list(10),
});

const graphOutput = z.object({
  rationale: str(1500),
  nodes: z.array(z.object({
    key: str(40),
    type: z.enum(NODE_TYPES),
    title: str(140),
    description: z.string().trim().max(1000),
  })).max(25),
  edges: z.array(z.object({
    source: str(60),
    target: str(60),
    relationship: z.enum(RELATIONSHIP_TYPES),
    description: z.string().trim().max(300),
  })).max(40),
});

const roadmapTask = z.object({
  key: str(40),
  title: str(200),
  description: z.string().trim().max(1500),
  priority: z.enum(PRIORITIES),
  deliverables: list(6, 200),
  completionCriteria: z.string().trim().max(600),
  dependsOn: z.array(str(40)).max(8),
});

const roadmapOutput = z.object({
  title: str(140),
  objective: str(1000),
  rationale: str(1500),
  phases: z.array(z.object({
    title: str(140),
    description: z.string().trim().max(1000),
    milestones: z.array(z.object({ title: str(140), description: z.string().trim().max(600) })).max(5),
    tasks: z.array(roadmapTask).max(12),
  })).min(1).max(8),
});

const taskImprovementOutput = z.object({
  summary: str(1500),
  improvements: z.array(z.object({
    taskRef: str(40),
    title: z.string().trim().max(200),
    description: z.string().trim().max(1500),
    priority: z.union([z.enum(PRIORITIES), z.literal('')]),
    completionCriteria: z.string().trim().max(600),
    reason: str(500),
  })).max(20),
  missingTasks: z.array(z.object({
    title: str(200),
    description: z.string().trim().max(1500),
    priority: z.enum(PRIORITIES),
    reason: str(500),
  })).max(10),
});

const chatOutput = z.object({
  answer: str(6000),
  followUps: z.array(str(200)).max(4),
});

const replanOutput = z.object({
  explanation: str(1500),
  actions: z.array(z.object({
    title: str(200),
    description: z.string().trim().max(1000),
    priority: z.enum(PRIORITIES),
    reason: str(400),
  })).max(6),
});

module.exports = { analysisOutput, graphOutput, roadmapOutput, taskImprovementOutput, chatOutput, replanOutput };
