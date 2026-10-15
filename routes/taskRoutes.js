'use strict';

const express = require('express');
const tasks = require('../controllers/taskController');
const { requireAuth } = require('../middleware/requireAuth');
const { requireProjectOwner } = require('../middleware/requireProjectOwner');
const { validateRequest } = require('../middleware/validateRequest');
const { validateObjectId } = require('../middleware/validateObjectId');
const v = require('../validators/planValidators');

const router = express.Router();
const owner = [requireAuth, requireProjectOwner];
const base = '/projects/:projectId/tasks';

router.get(base, owner, tasks.index);
router.get(`${base}/new`, owner, tasks.newForm);
router.post(base, owner, validateRequest(v.createTaskSchema, { onError: tasks.renderFormErrors }), tasks.create);
router.post(`${base}/reorder`, owner, validateRequest(v.reorderTasksSchema), tasks.reorder);
router.get(`${base}/:taskId/edit`, owner, validateObjectId('taskId'), tasks.editForm);
router.post(`${base}/:taskId/update`, owner, validateObjectId('taskId'), validateRequest(v.updateTaskSchema, { onError: tasks.renderFormErrors }), tasks.update);
router.patch(`${base}/:taskId`, owner, validateObjectId('taskId'), validateRequest(v.patchTaskSchema), tasks.patch);
router.post(`${base}/:taskId/delete`, owner, validateObjectId('taskId'), tasks.destroy);

module.exports = router;
