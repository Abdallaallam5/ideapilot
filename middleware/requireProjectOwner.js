'use strict';

const mongoose = require('mongoose');
const Project = require('../models/Project');
const { notFound } = require('../utils/httpError');
const logger = require('../utils/logger');

/**
 * Loads :projectId and verifies it belongs to the signed-in user.
 * Non-owners get a 404 (not 403) so project ids cannot be probed.
 */
async function requireProjectOwner(req, res, next) {
  const { projectId } = req.params;
  if (!mongoose.isValidObjectId(projectId)) return next(notFound('Project not found.'));
  const project = await Project.findOne({ _id: projectId, owner: req.user._id });
  if (!project) {
    // Logged so a 404 in production can be told apart: missing project or someone else's.
    const exists = await Project.exists({ _id: projectId });
    logger.warn('Project not found for this user', { path: req.path, projectId, userId: String(req.user._id), projectExists: Boolean(exists) });
    return next(notFound('Project not found.'));
  }
  req.project = project;
  res.locals.project = project;
  return next();
}

module.exports = { requireProjectOwner };
