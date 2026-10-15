'use strict';

const mongoose = require('mongoose');
const { PLAN_SOURCES, TASK_STATUSES, PRIORITIES } = require('./constants');

const milestoneSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 140 },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  dueDate: Date,
  completed: { type: Boolean, default: false },
  completedAt: Date,
});

const phaseSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 140 },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  order: { type: Number, default: 0 },
  milestones: { type: [milestoneSchema], default: [] },
});

// Frozen copy of a task, stored when a plan version is archived so it can be restored.
const taskSnapshotSchema = new mongoose.Schema(
  {
    taskId: mongoose.Schema.Types.ObjectId,
    phaseId: mongoose.Schema.Types.ObjectId,
    milestoneId: mongoose.Schema.Types.ObjectId,
    linkedNode: mongoose.Schema.Types.ObjectId,
    title: String,
    description: String,
    status: { type: String, enum: TASK_STATUSES },
    priority: { type: String, enum: PRIORITIES },
    dependencies: [mongoose.Schema.Types.ObjectId],
    deliverables: [String],
    completionCriteria: String,
    deadline: Date,
    completedAt: Date,
    order: Number,
  },
  { _id: false }
);

const planSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    version: { type: Number, required: true, min: 1 },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    objective: { type: String, trim: true, maxlength: 2000, default: '' },
    phases: { type: [phaseSchema], default: [] },
    status: { type: String, enum: ['current', 'archived'], default: 'current' },
    source: { type: String, enum: PLAN_SOURCES, default: 'manual' },
    changeSummary: { type: String, trim: true, maxlength: 2000, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    restoredFromVersion: Number,
    tasksSnapshot: { type: [taskSnapshotSchema], default: [] },
    archivedAt: Date,
  },
  { timestamps: true }
);

planSchema.index({ project: 1, version: -1 }, { unique: true });
planSchema.index({ project: 1, status: 1 });

module.exports = mongoose.models.Plan || mongoose.model('Plan', planSchema);
