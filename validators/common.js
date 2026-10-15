'use strict';

const { z } = require('zod');
const mongoose = require('mongoose');
const { linesToList } = require('../utils/format');

const emptyToUndefined = (v) => (v === '' || v === null ? undefined : v);

const text = (max, msg) => z.string({ error: msg || 'This field is required.' }).trim().max(max, `Must be at most ${max} characters.`);
const requiredText = (max, name) => z.string({ error: `${name} is required.` }).trim().min(1, `${name} is required.`).max(max, `${name} must be at most ${max} characters.`);
const optionalText = (max) => z.preprocess((v) => (v === null || v === undefined ? undefined : v), text(max).optional());

const objectId = z.string().trim().refine((v) => mongoose.isValidObjectId(v), 'Invalid reference.');
const optionalObjectId = z.preprocess(emptyToUndefined, objectId.optional());
/** Like optionalObjectId but keeps an explicit empty value as null (to clear a reference). */
const nullableObjectId = z.preprocess((v) => (v === '' || v === 'none' ? null : v), objectId.nullable().optional());

const idList = z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return [];
  return (Array.isArray(v) ? v : [v]).filter((x) => x !== '');
}, z.array(objectId).max(50, 'Too many items.'));

const linesList = (max = 50, maxLength = 500) =>
  z.preprocess((v) => (v === undefined ? undefined : linesToList(v, { max, maxLength })), z.array(z.string()).max(max).optional());

const optionalDate = z.preprocess((v) => {
  if (v === '' || v === null) return null;
  if (v === undefined) return undefined;
  return v;
}, z.union([z.null(), z.coerce.date().refine((d) => !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2100, 'Enter a valid date.')]).optional());

const checkbox = z.preprocess((v) => {
  if (Array.isArray(v)) v = v[v.length - 1];
  return v === true || v === 'true' || v === 'on' || v === '1';
}, z.boolean());

module.exports = { z, text, requiredText, optionalText, objectId, optionalObjectId, nullableObjectId, idList, linesList, optionalDate, checkbox, emptyToUndefined };
