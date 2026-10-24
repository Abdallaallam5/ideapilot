'use strict';

const mongoose = require('mongoose');

const aiConversationSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['analysis', 'graph', 'roadmap', 'tasks', 'replan', 'chat', 'idea', 'taskdraft'], required: true },
    prompt: { type: String, maxlength: 4000, default: '' },
    response: { type: String, maxlength: 20000, default: '' },
    status: { type: String, enum: ['succeeded', 'failed'], required: true },
    error: { type: String, maxlength: 500, default: '' },
    provider: String,
    model: String,
    durationMs: Number,
    usage: { inputTokens: Number, outputTokens: Number },
    proposal: { type: mongoose.Schema.Types.ObjectId, ref: 'Proposal', default: null },
  },
  { timestamps: true }
);

aiConversationSchema.index({ project: 1, createdAt: -1 });
aiConversationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.models.AIConversation || mongoose.model('AIConversation', aiConversationSchema);
