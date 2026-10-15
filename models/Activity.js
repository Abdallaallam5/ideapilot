'use strict';

const mongoose = require('mongoose');

const ACTIVITY_TYPES = [
  'project_created', 'project_updated', 'analysis_updated',
  'node_created', 'node_updated', 'node_deleted', 'edge_created', 'edge_updated', 'edge_deleted',
  'plan_updated', 'phase_created', 'phase_updated', 'phase_deleted', 'milestone_updated',
  'plan_version_created', 'plan_restored',
  'task_created', 'task_updated', 'task_status_changed', 'task_deleted',
  'decision_recorded', 'decision_updated',
  'proposal_created', 'proposal_accepted', 'proposal_rejected', 'ai_failed',
];

const activitySchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    message: { type: String, required: true, maxlength: 500 },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

activitySchema.index({ project: 1, createdAt: -1 });

activitySchema.statics.ACTIVITY_TYPES = ACTIVITY_TYPES;

module.exports = mongoose.models.Activity || mongoose.model('Activity', activitySchema);
