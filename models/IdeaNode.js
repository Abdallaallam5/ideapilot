'use strict';

const mongoose = require('mongoose');
const { NODE_TYPES, NODE_STATUSES, PRIORITIES } = require('./constants');

const ideaNodeSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    type: { type: String, enum: NODE_TYPES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 4000, default: '' },
    position: {
      x: { type: Number, default: 0, min: -100000, max: 100000 },
      y: { type: Number, default: 0, min: -100000, max: 100000 },
    },
    status: { type: String, enum: NODE_STATUSES, default: 'open' },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    metadata: {
      source: { type: String, enum: ['manual', 'ai', 'system'], default: 'manual' },
      color: { type: String, maxlength: 20 },
      tags: { type: [{ type: String, maxlength: 40 }], default: [] },
    },
  },
  { timestamps: true }
);

ideaNodeSchema.index({ project: 1, type: 1 });

module.exports = mongoose.models.IdeaNode || mongoose.model('IdeaNode', ideaNodeSchema);
