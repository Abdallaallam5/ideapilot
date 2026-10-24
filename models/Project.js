'use strict';

const mongoose = require('mongoose');
const { PROJECT_STAGES, PROJECT_STATUSES } = require('./constants');

const listField = { type: [{ type: String, trim: true, maxlength: 500 }], default: [] };

const projectSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    desiredOutcome: { type: String, trim: true, maxlength: 2000, default: '' },
    targetAudience: { type: String, trim: true, maxlength: 1000, default: '' },
    budget: { type: String, trim: true, maxlength: 200, default: '' },
    availableTime: { type: String, trim: true, maxlength: 200, default: '' },
    skillsResources: { type: String, trim: true, maxlength: 2000, default: '' },
    constraints: { type: String, trim: true, maxlength: 2000, default: '' },
    stage: { type: String, enum: PROJECT_STAGES, default: 'idea' },
    status: { type: String, enum: PROJECT_STATUSES, default: 'active' },
    currentPlan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },
    currentPlanVersion: { type: Number, default: 1, min: 1 },
    analysis: {
      summary: { type: String, trim: true, maxlength: 5000, default: '' },
      goals: listField,
      coreComponents: listField,
      assumptions: listField,
      risks: listField,
      unknowns: listField,
      opportunities: listField,
      nextSteps: listField,
      updatedAt: Date,
      // Map nodes already copied into the lists, so items the user deletes are not re-added.
      mapSynced: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    },
  },
  { timestamps: true }
);

projectSchema.index({ owner: 1, updatedAt: -1 });
projectSchema.index({ owner: 1, stage: 1 });

module.exports = mongoose.models.Project || mongoose.model('Project', projectSchema);
