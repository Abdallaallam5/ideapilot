'use strict';

const mongoose = require('mongoose');
const { RELATIONSHIP_TYPES } = require('./constants');

const ideaEdgeSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    source: { type: mongoose.Schema.Types.ObjectId, ref: 'IdeaNode', required: true },
    target: { type: mongoose.Schema.Types.ObjectId, ref: 'IdeaNode', required: true },
    relationship: { type: String, enum: RELATIONSHIP_TYPES, default: 'related_to' },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
  },
  { timestamps: true }
);

ideaEdgeSchema.index({ project: 1 });
ideaEdgeSchema.index({ project: 1, source: 1, target: 1, relationship: 1 }, { unique: true });
ideaEdgeSchema.index({ source: 1 });
ideaEdgeSchema.index({ target: 1 });

ideaEdgeSchema.pre('validate', function () {
  if (this.source && this.target && this.source.equals(this.target)) {
    this.invalidate('target', 'A node cannot be connected to itself.');
  }
});

module.exports = mongoose.models.IdeaEdge || mongoose.model('IdeaEdge', ideaEdgeSchema);
