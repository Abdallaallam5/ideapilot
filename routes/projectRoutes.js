'use strict';

const express = require('express');
const projects = require('../controllers/projectController');
const { requireAuth } = require('../middleware/requireAuth');
const { requireProjectOwner } = require('../middleware/requireProjectOwner');
const { validateRequest } = require('../middleware/validateRequest');
const { createProjectSchema, updateProjectSchema, analysisSchema } = require('../validators/projectValidators');

const router = express.Router();
const owner = [requireAuth, requireProjectOwner];

router.get('/projects', requireAuth, (req, res) => res.redirect('/dashboard'));
router.get('/projects/new', requireAuth, projects.newForm);
// The write-your-idea/tasks forms post here; a refresh, back button or post-login return lands on GET.
router.get('/projects/from-text', requireAuth, (req, res) => res.redirect('/projects/new'));
router.get('/projects/:projectId/tasks/from-text', owner, (req, res) => res.redirect(`/projects/${req.params.projectId}/tasks`));
router.post('/projects', requireAuth, validateRequest(createProjectSchema, { onError: projects.renderCreateErrors }), projects.create);

router.get('/projects/:projectId', owner, projects.open);
router.get('/projects/:projectId/map', owner, projects.map);
router.get('/projects/:projectId/analysis', owner, projects.analysis);
router.post('/projects/:projectId/analysis', owner, validateRequest(analysisSchema), projects.saveAnalysis);
router.post('/projects/:projectId/analysis/sync-map', owner, projects.syncAnalysis);
router.get('/projects/:projectId/edit', owner, projects.editForm);
router.post('/projects/:projectId/update', owner, validateRequest(updateProjectSchema, { onError: projects.renderUpdateErrors }), projects.update);
router.post('/projects/:projectId/delete', owner, projects.destroy);

module.exports = router;
