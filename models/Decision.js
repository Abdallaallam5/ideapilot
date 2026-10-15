'use strict';

const mongoose = require('mongoose');
const { DECISION_STATUSES } = require('./constants');

const decisionSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    rationale: { type: String, trim: true, maxlength: 4000, default: '' },
    status: { type: String, enum: DECISION_STATUSES, default: 'accepted' },
    relatedNode: { type: mongoose.Schema.Types.ObjectId, ref: 'IdeaNode', default: null },
    planVersion: Number,
    proposal: { type: mongoose.Schema.Types.ObjectId, ref: 'Proposal', default: null },
    madeBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

decisionSchema.index({ project: 1, createdAt: -1 });

module.exports = mongoose.models.Decision || mongoose.model('Decision', decisionSchema);
