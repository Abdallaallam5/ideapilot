'use strict';

const projectService = require('../services/projectService');
const { dashboardQuerySchema } = require('../validators/projectValidators');

async function show(req, res) {
  const filters = dashboardQuerySchema.parse(req.query);
  const [projects, totals] = await Promise.all([
    projectService.listProjects(req.user, filters),
    projectService.dashboardSummary(req.user),
  ]);
  res.render('pages/dashboard', {
    title: 'Dashboard',
    projects,
    totals,
    filters,
    hasFilters: Boolean(filters.q || filters.stage || filters.status),
  });
}

module.exports = { show };
