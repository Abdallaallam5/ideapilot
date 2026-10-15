'use strict';

const { z, requiredText, optionalText, optionalDate, checkbox, objectId, nullableObjectId, idList, linesList } = require('./common');
const { TASK_STATUSES, PRIORITIES, NODE_STATUSES, DECISION_STATUSES } = require('../models/constants');

const planMetaSchema = z.object({ title: requiredText(140, 'Plan title'), objective: optionalText(2000) });
const phaseSchema = z.object({ title: requiredText(140, 'Phase title'), description: optionalText(2000) });
const milestoneSchema = z.object({ title: requiredText(140, 'Milestone title'), description: optionalText(2000), dueDate: optionalDate });
const milestoneToggleSchema = z.object({ completed: checkbox });
const reorderPhasesSchema = z.object({ orderedIds: z.array(objectId).min(1).max(30) });
const movePhaseSchema = z.object({ direction: z.enum(['up', 'down']) });
const versionSchema = z.object({ changeSummary: requiredText(2000, 'Change summary') });

const taskBase = {
  title: requiredText(200, 'Title'),
  description: optionalText(4000),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  phaseId: nullableObjectId,
  milestoneId: nullableObjectId,
  linkedNode: nullableObjectId,
  dependencies: idList.optional(),
  deliverables: linesList(20, 300),
  completionCriteria: optionalText(2000),
  deadline: optionalDate,
  blockedReason: optionalText(500),
};

const createTaskSchema = z.object(taskBase);
const updateTaskSchema = z.object(Object.fromEntries(Object.entries(taskBase).map(([k, v]) => [k, v.optional()])));
const patchTaskSchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  deadline: optionalDate,
  phaseId: nullableObjectId,
  title: requiredText(200, 'Title').optional(),
  blockedReason: optionalText(500),
}).strict();
const reorderTasksSchema = z.object({
  orderedIds: z.array(objectId).min(1).max(500),
  phaseId: nullableObjectId,
  status: z.enum(TASK_STATUSES).optional(),
}).strict();

const taskQuerySchema = z.object({
  view: z.enum(['list', 'kanban']).optional().catch(undefined),
  status: z.enum([...TASK_STATUSES, 'overdue']).optional().catch(undefined),
  priority: z.enum(PRIORITIES).optional().catch(undefined),
  phaseId: z.string().regex(/^([a-f0-9]{24}|none)$/i).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  sort: z.enum(['order', 'deadline', 'priority', 'status']).optional().catch(undefined),
});

const replanSchema = z.object({
  nodeId: objectId,
  changeType: z.enum(['invalidated', 'changed']),
  note: optionalText(1000),
  useAI: checkbox.optional(),
});

const decisionSchema = z.object({
  title: requiredText(200, 'Decision'),
  rationale: optionalText(4000),
  status: z.enum(DECISION_STATUSES).optional(),
  relatedNode: nullableObjectId,
});
const decisionStatusSchema = z.object({ status: z.enum(DECISION_STATUSES) });

const proposalAcceptSchema = z.object({
  items: z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.string().max(60).regex(/^[a-z]+:[A-Za-z0-9_]+$/)).max(500)),
  mode: z.enum(['append', 'replace']).optional(),
});

module.exports = {
  planMetaSchema, phaseSchema, milestoneSchema, milestoneToggleSchema, reorderPhasesSchema, movePhaseSchema, versionSchema,
  createTaskSchema, updateTaskSchema, patchTaskSchema, reorderTasksSchema, taskQuerySchema,
  replanSchema, decisionSchema, decisionStatusSchema, proposalAcceptSchema, NODE_STATUSES,
};
