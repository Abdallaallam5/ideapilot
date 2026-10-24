'use strict';

const { z } = require('zod');
const { NODE_TYPES, RELATIONSHIP_TYPES, PRIORITIES } = require('../models/constants');

// Schemas for model output. Every response is validated against one of these
// before it can become a proposal; anything else is rejected.
const str = (max) => z.string().trim().min(1).max(max);

// The root idea node is created by the app, so the model may not add another one.
const MAP_NODE_TYPES = NODE_TYPES.filter((t) => t !== 'idea');

/** A free-text idea turned into a project title, description and map elements. */
const ideaOutput = z.object({
  title: str(140),
  description: str(2000),
  nodes: z.array(z.object({
    key: str(40),
    type: z.enum(MAP_NODE_TYPES),
    title: str(140),
    description: z.string().trim().max(1000),
  })).max(25),
  edges: z.array(z.object({
    source: str(60),
    target: str(60),
    relationship: z.enum(RELATIONSHIP_TYPES),
    description: z.string().trim().max(300),
  })).max(40),
  // A starter roadmap: ordered phases, each with checkpoints and first tasks.
  phases: z.array(z.object({
    title: str(140),
    description: z.string().trim().max(600),
    milestones: z.array(str(140)).max(4),
    tasks: z.array(z.object({
      title: str(200),
      priority: z.enum(PRIORITIES),
    })).max(5),
  })).max(6).default([]),
});

/** Free-text to-dos turned into structured tasks. */
const taskDraftOutput = z.object({
  tasks: z.array(z.object({
    key: str(40),
    title: str(200),
    description: z.string().trim().max(1500),
    priority: z.enum(PRIORITIES),
    phase: z.string().trim().max(60),
    linkedNode: z.string().trim().max(20),
    dependsOn: z.array(str(40)).max(8),
  })).min(1).max(20),
});

module.exports = { ideaOutput, taskDraftOutput };
