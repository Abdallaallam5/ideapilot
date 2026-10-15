'use strict';

const express = require('express');
const plans = require('../controllers/planController');
const { requireAuth } = require('../middleware/requireAuth');
const { requireProjectOwner } = require('../middleware/requireProjectOwner');
const { validateRequest } = require('../middleware/validateRequest');
const { validateObjectId } = require('../middleware/validateObjectId');
const v = require('../validators/planValidators');

const router = express.Router();
const owner = [requireAuth, requireProjectOwner];
const base = '/projects/:projectId/plan';
const back = (req) => `/projects/${req.params.projectId}/roadmap`;

router.get('/projects/:projectId/roadmap', owner, plans.roadmap);
router.post(`${base}/update`, owner, validateRequest(v.planMetaSchema, { redirect: back }), plans.updateMeta);
router.post(`${base}/phases`, owner, validateRequest(v.phaseSchema, { redirect: back }), plans.addPhase);
router.post(`${base}/phases/reorder`, owner, validateRequest(v.reorderPhasesSchema), plans.reorderPhases);
router.post(`${base}/phases/:phaseId/update`, owner, validateObjectId('phaseId'), validateRequest(v.phaseSchema, { redirect: back }), plans.updatePhase);
router.post(`${base}/phases/:phaseId/delete`, owner, validateObjectId('phaseId'), plans.deletePhase);
router.post(`${base}/phases/:phaseId/move`, owner, validateObjectId('phaseId'), validateRequest(v.movePhaseSchema, { redirect: back }), plans.movePhase);
router.post(`${base}/phases/:phaseId/milestones`, owner, validateObjectId('phaseId'), validateRequest(v.milestoneSchema, { redirect: back }), plans.addMilestone);
router.post(`${base}/phases/:phaseId/milestones/:milestoneId/update`, owner, validateObjectId('phaseId', 'milestoneId'), validateRequest(v.milestoneSchema.partial(), { redirect: back }), plans.updateMilestone);
router.post(`${base}/phases/:phaseId/milestones/:milestoneId/toggle`, owner, validateObjectId('phaseId', 'milestoneId'), validateRequest(v.milestoneToggleSchema, { redirect: back }), plans.updateMilestone);
router.post(`${base}/phases/:phaseId/milestones/:milestoneId/delete`, owner, validateObjectId('phaseId', 'milestoneId'), plans.deleteMilestone);
router.post(`${base}/versions`, owner, validateRequest(v.versionSchema, { redirect: back }), plans.saveVersion);

module.exports = router;
