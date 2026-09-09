/**
 * @fileoverview Joi validation for date-effective project rates
 * @module schemas/business/project-rate
 */

import Joi from 'joi';

const isoDate = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({ 'string.pattern.base': 'Date must be in YYYY-MM-DD format' });

export const projectRateIdSchema = Joi.object({
  rateId: Joi.string().uuid().required().messages({
    'string.guid': 'Rate ID must be a valid UUID',
  }),
});

export const projectIdParamSchema = Joi.object({
  id: Joi.string().uuid().required().messages({
    'string.guid': 'Project ID must be a valid UUID',
  }),
});

/**
 * A new rate period. `valid_from` is deliberately allowed to be in the future —
 * agreeing in November that the rate rises on 1 January is the main reason this
 * feature exists.
 */
export const createProjectRateSchema = Joi.object({
  hourly_rate: Joi.number().min(0).max(99999999.99).required(),
  valid_from: isoDate.required(),
  note: Joi.string().max(1000).optional().allow('', null),
});

export const updateProjectRateSchema = Joi.object({
  hourly_rate: Joi.number().min(0).max(99999999.99).optional(),
  valid_from: isoDate.optional(),
  note: Joi.string().max(1000).optional().allow('', null),
}).min(1);

/**
 * Query for "what does this project cost on date X" — used by the time-entry
 * form to show the rate an entry would be stamped with before it is saved.
 */
export const effectiveRateQuerySchema = Joi.object({
  date: isoDate.optional(),
});
