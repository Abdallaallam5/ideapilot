'use strict';

const mongoose = require('mongoose');
const { TASK_STATUSES, PRIORITIES } = require('./constants');

const taskSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
    phaseId: { type: mongoose.Schema.Types.ObjectId, default: null },
    milestoneId: { type: mongoose.Schema.Types.ObjectId, default: null },
    linkedNode: { type: mongoose.Schema.Types.ObjectId, ref: 'IdeaNode', default: null },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 4000, default: '' },
    status: { type: String, enum: TASK_STATUSES, default: 'todo' },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    dependencies: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Task' }], default: [] },
    deliverables: { type: [{ type: String, trim: true, maxlength: 300 }], default: [] },
    completionCriteria: { type: String, trim: true, maxlength: 2000, default: '' },
    deadline: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    order: { type: Number, default: 0 },
    blockedReason: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true }
);

taskSchema.index({ project: 1, status: 1 });
taskSchema.index({ project: 1, phaseId: 1, order: 1 });
taskSchema.index({ dependencies: 1 });

taskSchema.pre('validate', function () {
  if (this.dependencies?.some((d) => d.equals(this._id))) {
    this.invalidate('dependencies', 'A task cannot depend on itself.');
  }
  if (this.isModified('status')) {
    this.completedAt = this.status === 'completed' ? this.completedAt || new Date() : null;
  }
});

module.exports = mongoose.models.Task || mongoose.model('Task', taskSchema);
