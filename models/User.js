'use strict';

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    email: {
      type: String, required: true, trim: true, lowercase: true, maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email is invalid'],
    },
    passwordHash: { type: String, required: true, select: true },
    settings: {
      defaultTaskView: { type: String, enum: ['list', 'kanban'], default: 'list' },
      aiEnabled: { type: Boolean, default: true },
    },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

userSchema.index({ email: 1 }, { unique: true });

userSchema.set('toJSON', {
  transform(doc, ret) {
    delete ret.passwordHash;
    return ret;
  },
});

userSchema.statics.normalizeEmail = (email) => String(email || '').trim().toLowerCase();

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
