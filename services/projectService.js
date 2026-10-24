'use strict';

const mongoose = require('mongoose');
const Project = require('../models/Project');
const IdeaNode = require('../models/IdeaNode');
const IdeaEdge = require('../models/IdeaEdge');
const Plan = require('../models/Plan');
const Task = require('../models/Task');
const Decision = require('../models/Decision');
const Activity = require('../models/Activity');
const AIConversation = require('../models/AIConversation');
const Proposal = require('../models/Proposal');
const { tr } = require('../utils/requestContext');
const activity = require('./activityService');
const { escapeRegex } = require('../utils/http');

const ANALYSIS_LISTS = ['goals', 'coreComponents', 'assumptions', 'risks', 'unknowns', 'opportunities', 'nextSteps'];
const EDITABLE_FIELDS = ['title', 'description', 'desiredOutcome', 'targetAudience', 'budget', 'availableTime', 'skillsResources', 'constraints', 'stage', 'status'];

/** Creates the project with its first plan version and a root idea node on the map. */
async function createProject(user, data) {
  const project = new Project({ ...pick(data, EDITABLE_FIELDS), owner: user._id });
  const plan = new Plan({
    project: project._id,
    version: 1,
    title: tr('{title} plan', { title: project.title }).slice(0, 140),
    objective: project.desiredOutcome || '',
    source: 'initial',
    changeSummary: 'Initial empty plan created with the project.',
    createdBy: user._id,
  });
  project.currentPlan = plan._id;
  project.currentPlanVersion = 1;
  await project.save();
  try {
    await plan.save();
    await IdeaNode.create({
      project: project._id,
      type: 'idea',
      title: project.title,
      description: project.description.slice(0, 4000),
      position: { x: 0, y: 0 },
      priority: 'high',
      metadata: { source: 'system' },
    });
  } catch (err) {
    await deleteProjectData(project._id);
    await Project.deleteOne({ _id: project._id });
    throw err;
  }
  await activity.record(project._id, user._id, 'project_created', `Created idea "${project.title}"`);
  return project;
}

async function updateProject(project, data, user) {
  const changes = pick(data, EDITABLE_FIELDS);
  const changedKeys = Object.keys(changes).filter((k) => String(project[k] ?? '') !== String(changes[k] ?? ''));
  if (!changedKeys.length) return project;
  Object.assign(project, changes);
  await project.save();
  await activity.record(project._id, user._id, 'project_updated', `Updated project ${changedKeys.join(', ')}`, { fields: changedKeys });
  return project;
}

async function deleteProjectData(projectId) {
  await Promise.all([
    IdeaNode.deleteMany({ project: projectId }),
    IdeaEdge.deleteMany({ project: projectId }),
    Plan.deleteMany({ project: projectId }),
    Task.deleteMany({ project: projectId }),
    Decision.deleteMany({ project: projectId }),
    Activity.deleteMany({ project: projectId }),
    AIConversation.deleteMany({ project: projectId }),
    Proposal.deleteMany({ project: projectId }),
  ]);
}

/** Deletes a project and everything that belongs to it. */
async function deleteProject(project) {
  await deleteProjectData(project._id);
  await Project.deleteOne({ _id: project._id, owner: project.owner });
}

/** Per-project task statistics used by the dashboard and workspace header. */
async function taskStats(projectIds) {
  const ids = projectIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const now = new Date();
  const rows = await Task.aggregate([
    { $match: { project: { $in: ids } } },
    {
      $group: {
        _id: '$project',
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        inProgress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
        blocked: { $sum: { $cond: [{ $eq: ['$status', 'blocked'] }, 1, 0] } },
        overdue: {
          $sum: { $cond: [{ $and: [{ $ne: ['$status', 'completed'] }, { $ne: ['$deadline', null] }, { $lt: ['$deadline', now] }] }, 1, 0] },
        },
      },
    },
  ]);
  const map = new Map();
  for (const r of rows) {
    map.set(String(r._id), {
      total: r.total,
      completed: r.completed,
      inProgress: r.inProgress,
      blocked: r.blocked,
      overdue: r.overdue,
      active: r.total - r.completed,
      progress: r.total ? Math.round((r.completed / r.total) * 100) : 0,
    });
  }
  const empty = { total: 0, completed: 0, inProgress: 0, blocked: 0, overdue: 0, active: 0, progress: 0 };
  return (id) => map.get(String(id)) || empty;
}

const SORTS = {
  updated: { updatedAt: -1 },
  created: { createdAt: -1 },
  title: { title: 1 },
};

async function listProjects(user, { q, stage, status, sort } = {}) {
  const filter = { owner: user._id };
  if (q) {
    const rx = new RegExp(escapeRegex(q.slice(0, 100)), 'i');
    filter.$or = [{ title: rx }, { description: rx }];
  }
  if (stage) filter.stage = stage;
  if (status) filter.status = status;
  const projects = await Project.find(filter)
    .sort(SORTS[sort] || SORTS.updated)
    .collation({ locale: 'en', strength: 2 })
    .limit(200)
    .lean();
  const statsFor = await taskStats(projects.map((p) => p._id));
  return projects.map((p) => ({ ...p, stats: statsFor(p._id) }));
}

async function dashboardSummary(user) {
  const projects = await Project.find({ owner: user._id }).select('_id').lean();
  const statsFor = await taskStats(projects.map((p) => p._id));
  const totals = { projects: projects.length, activeTasks: 0, overdue: 0, completed: 0 };
  for (const p of projects) {
    const s = statsFor(p._id);
    totals.activeTasks += s.active;
    totals.overdue += s.overdue;
    totals.completed += s.completed;
  }
  return totals;
}

async function updateAnalysis(project, data, user) {
  project.analysis = project.analysis || {};
  project.analysis.summary = data.summary ?? project.analysis.summary;
  for (const key of ANALYSIS_LISTS) {
    if (Array.isArray(data[key])) project.analysis[key] = data[key];
  }
  project.analysis.updatedAt = new Date();
  project.markModified('analysis');
  await project.save();
  await activity.record(project._id, user._id, 'analysis_updated', 'Updated the project analysis');
  return project;
}

const NODE_TYPE_TO_SECTION = {
  goal: 'goals',
  assumption: 'assumptions',
  risk: 'risks',
  resource: 'coreComponents',
  milestone: 'coreComponents',
};

/**
 * Copies goals, assumptions, risks and resources from the map into the analysis lists.
 * Runs automatically; each node is copied once, so items the user removes stay removed.
 */
async function syncAnalysisFromMap(project, user) {
  const synced = new Set((project.analysis.mapSynced || []).map(String));
  const nodes = await IdeaNode.find({ project: project._id, type: { $in: Object.keys(NODE_TYPE_TO_SECTION) } }).sort({ createdAt: 1 }).lean();
  const fresh = nodes.filter((n) => !synced.has(String(n._id)));
  let added = 0;
  for (const node of fresh) {
    const section = NODE_TYPE_TO_SECTION[node.type];
    const list = project.analysis[section] || [];
    const exists = list.some((item) => item.toLowerCase().startsWith(node.title.toLowerCase()));
    if (!exists && list.length < 50) {
      list.push(node.title);
      project.analysis[section] = list;
      added++;
    }
  }
  if (!project.analysis.summary && !project.analysis.updatedAt && project.description) {
    project.analysis.summary = project.description;
    added++;
  }
  if (!fresh.length && !added) return 0;
  project.analysis.mapSynced = [...(project.analysis.mapSynced || []), ...fresh.map((n) => n._id)];
  if (added) project.analysis.updatedAt = new Date();
  project.markModified('analysis');
  await project.save();
  return added;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

module.exports = {
  createProject, updateProject, deleteProject, listProjects, dashboardSummary, taskStats,
  updateAnalysis, syncAnalysisFromMap, ANALYSIS_LISTS,
};
