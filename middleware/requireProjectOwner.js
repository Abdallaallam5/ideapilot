'use strict';

const mongoose = require('mongoose');
const Project = require('../models/Project');
const { notFound } = require('../utils/httpError');

/**
 * Loads :projectId and verifies it belongs to the signed-in user.
 * Non-owners get a 404 (not 403) so project ids cannot be probed.
 */
async function requireProjectOwner(req, res, next) {
  const { projectId } = req.params;
  if (!mongoose.isValidObjectId(projectId)) return next(notFound('Project not found.'));
  const project = await Project.findOne({ _id: projectId, owner: req.user._id });
  if (!project) return next(notFound('Project not found.'));
  req.project = project;
  res.locals.project = project;
  return next();
}

module.exports = { requireProjectOwner };
