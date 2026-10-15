'use strict';

const mongoose = require('mongoose');
const { PROPOSAL_KINDS, PROPOSAL_STATUSES } = require('./constants');

/**
 * A pending change set (from AI or from deterministic replanning) that the
 * user must review. Nothing in `payload` touches real data until accepted.
 */
const proposalSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    kind: { type: String, enum: PROPOSAL_KINDS, required: true },
    origin: { type: String, enum: ['ai', 'system'], required: true },
    title: { type: String, required: true, maxlength: 200 },
    summary: { type: String, maxlength: 6000, default: '' },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, enum: PROPOSAL_STATUSES, default: 'pending' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
    resultPlanVersion: Number,
    appliedSummary: { type: String, maxlength: 2000, default: '' },
  },
  { timestamps: true }
);

proposalSchema.index({ project: 1, status: 1, createdAt: -1 });

module.exports = mongoose.models.Proposal || mongoose.model('Proposal', proposalSchema);
