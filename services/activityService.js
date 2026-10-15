'use strict';

const Activity = require('../models/Activity');
const logger = require('../utils/logger');

/** Records a meaningful project event. Failures are logged, never thrown, so they cannot break the main action. */
async function record(projectId, userId, type, message, meta = {}) {
  try {
    await Activity.create({ project: projectId, user: userId, type, message: String(message).slice(0, 500), meta });
  } catch (err) {
    logger.warn('Failed to record activity', { error: err, type });
  }
}

async function list(projectId, { page = 1, limit = 30 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const [items, total] = await Promise.all([
    Activity.find({ project: projectId }).sort({ createdAt: -1 }).skip((safePage - 1) * limit).limit(limit).lean(),
    Activity.countDocuments({ project: projectId }),
  ]);
  return { items, total, page: safePage, pages: Math.max(1, Math.ceil(total / limit)) };
}

module.exports = { record, list };
