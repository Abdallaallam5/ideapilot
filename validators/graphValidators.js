'use strict';

const { z, requiredText, optionalText, objectId } = require('./common');
const { NODE_TYPES, RELATIONSHIP_TYPES, NODE_STATUSES, PRIORITIES } = require('../models/constants');

const coordinate = z.coerce.number().finite().min(-100000).max(100000);
const position = z.object({ x: coordinate, y: coordinate });

const createNodeSchema = z.object({
  type: z.enum(NODE_TYPES, { error: 'Choose a valid node type.' }),
  title: requiredText(140, 'Title'),
  description: optionalText(4000),
  status: z.enum(NODE_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  position: position.optional(),
}).strict();

const updateNodeSchema = z.object({
  type: z.enum(NODE_TYPES).optional(),
  title: requiredText(140, 'Title').optional(),
  description: optionalText(4000),
  status: z.enum(NODE_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  position: position.optional(),
}).strict();

const positionsSchema = z.object({
  positions: z.array(z.object({ id: objectId, x: coordinate, y: coordinate })).max(500),
}).strict();

const createEdgeSchema = z.object({
  source: objectId,
  target: objectId,
  relationship: z.enum(RELATIONSHIP_TYPES, { error: 'Choose a valid relationship type.' }).default('related_to'),
  description: optionalText(1000),
}).strict().refine((d) => d.source !== d.target, { path: ['target'], message: 'A node cannot be connected to itself.' });

const updateEdgeSchema = z.object({
  relationship: z.enum(RELATIONSHIP_TYPES, { error: 'Choose a valid relationship type.' }).optional(),
  description: optionalText(1000),
}).strict();

module.exports = { createNodeSchema, updateNodeSchema, positionsSchema, createEdgeSchema, updateEdgeSchema };
