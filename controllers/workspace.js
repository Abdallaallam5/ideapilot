'use strict';

const Proposal = require('../models/Proposal');
const projectService = require('../services/projectService');
const aiService = require('../services/aiService');

const TABS = [
  { key: 'map', label: 'Map', icon: 'network' },
  { key: 'analysis', label: 'Analysis', icon: 'scan-search' },
  { key: 'roadmap', label: 'Roadmap', icon: 'milestone' },
  { key: 'tasks', label: 'Tasks', icon: 'list-checks' },
  { key: 'review', label: 'Review', icon: 'clipboard-check' },
];

/** Shared locals for every workspace tab (header, tabs, progress, AI status). */
async function workspaceLocals(req, tab) {
  const project = req.project;
  const [statsFor, pendingProposals] = await Promise.all([
    projectService.taskStats([project._id]),
    Proposal.countDocuments({ project: project._id, status: 'pending' }),
  ]);
  return {
    layout: 'layouts/workspace',
    tab,
    tabs: TABS,
    project,
    stats: statsFor(project._id),
    pendingProposals,
    aiStatus: aiService.status(),
    bodyClass: `workspace tab-${tab}`,
  };
}

module.exports = { workspaceLocals, TABS };
