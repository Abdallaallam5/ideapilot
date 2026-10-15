'use strict';

module.exports = Object.freeze({
  NODE_TYPES: ['idea', 'goal', 'assumption', 'risk', 'resource', 'decision', 'milestone', 'task', 'note'],
  RELATIONSHIP_TYPES: ['supports', 'depends_on', 'blocks', 'influences', 'alternative_to', 'part_of', 'tests', 'related_to'],
  NODE_STATUSES: ['open', 'in_progress', 'validated', 'invalidated', 'done'],
  PRIORITIES: ['low', 'medium', 'high', 'critical'],
  TASK_STATUSES: ['todo', 'in_progress', 'blocked', 'completed'],
  PROJECT_STAGES: ['idea', 'mapping', 'planning', 'executing', 'reviewing', 'done'],
  PROJECT_STATUSES: ['active', 'on_hold', 'completed', 'archived'],
  DECISION_STATUSES: ['proposed', 'accepted', 'rejected', 'superseded'],
  PLAN_SOURCES: ['manual', 'ai', 'replan', 'restore', 'initial'],
  PROPOSAL_KINDS: ['analysis', 'graph', 'roadmap', 'tasks', 'replan'],
  PROPOSAL_STATUSES: ['pending', 'accepted', 'rejected', 'failed'],
});
