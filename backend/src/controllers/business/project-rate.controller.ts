/**
 * @fileoverview HTTP layer for a project's date-effective hourly rates
 *
 * Every handler resolves the caller from the JWT and hands the id to the
 * service, which scopes each query by owner. Nothing here trusts a project or
 * rate id from the request on its own.
 *
 * @module controllers/business/project-rate
 */

import { Request, Response } from 'express';
import { projectRateService } from '../../services/business/project-rate.service';
import {
  createProjectRateSchema,
  updateProjectRateSchema,
  projectIdParamSchema,
  projectRateIdSchema,
  effectiveRateQuerySchema,
} from '../../schemas/business/project-rate.schema';
import { logger } from '../../utils/logger';

export class ProjectRateController {
  /**
   * GET /api/projects/:id/rates
   * The project's full rate timeline, oldest first.
   */
  listRates = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { error, value } = projectIdParamSchema.validate(req.params);
      if (error) {
        res.status(400).json({ error: 'Validation error', details: error.details });
        return;
      }

      const rates = await projectRateService.listRates(value.id, userId);
      res.status(200).json({ data: rates });
    } catch (error: any) {
      logger.error('Error listing project rates:', error);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  };

  /**
   * GET /api/projects/:id/rates/effective?date=YYYY-MM-DD
   * The rate a time entry on that date would be stamped with. Used by the time
   * entry form so the user sees the rate before saving.
   */
  getEffectiveRate = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { error: paramError, value: params } = projectIdParamSchema.validate(req.params);
      if (paramError) {
        res.status(400).json({ error: 'Validation error', details: paramError.details });
        return;
      }

      const { error: queryError, value: query } = effectiveRateQuerySchema.validate(req.query);
      if (queryError) {
        res.status(400).json({ error: 'Validation error', details: queryError.details });
        return;
      }

      const rate = await projectRateService.getEffectiveRate(params.id, userId, query.date);
      res.status(200).json({ data: { hourly_rate: rate, date: query.date || null } });
    } catch (error: any) {
      logger.error('Error resolving effective project rate:', error);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  };

  /**
   * POST /api/projects/:id/rates
   * Open a new rate period. A future valid_from is allowed and expected.
   */
  addRate = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { error: paramError, value: params } = projectIdParamSchema.validate(req.params);
      if (paramError) {
        res.status(400).json({ error: 'Validation error', details: paramError.details });
        return;
      }

      const { error: bodyError, value: body } = createProjectRateSchema.validate(req.body);
      if (bodyError) {
        res.status(400).json({ error: 'Validation error', details: bodyError.details });
        return;
      }

      const rate = await projectRateService.addRate(params.id, userId, body);
      if (!rate) {
        res.status(404).json({ error: 'Not found', message: 'Project not found' });
        return;
      }

      res.status(201).json({ data: rate });
    } catch (error: any) {
      // A duplicate start date is the user's mistake, not a server fault.
      if (/already starts on that date/.test(error.message)) {
        res.status(409).json({ error: 'Conflict', message: error.message });
        return;
      }
      logger.error('Error adding project rate:', error);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  };

  /**
   * PUT /api/projects/rates/:rateId
   * Correct a rate period. Time entries already stamped keep their rate.
   */
  updateRate = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { error: paramError, value: params } = projectRateIdSchema.validate(req.params);
      if (paramError) {
        res.status(400).json({ error: 'Validation error', details: paramError.details });
        return;
      }

      const { error: bodyError, value: body } = updateProjectRateSchema.validate(req.body);
      if (bodyError) {
        res.status(400).json({ error: 'Validation error', details: bodyError.details });
        return;
      }

      const rate = await projectRateService.updateRate(params.rateId, userId, body);
      if (!rate) {
        res.status(404).json({ error: 'Not found', message: 'Rate not found' });
        return;
      }

      res.status(200).json({ data: rate });
    } catch (error: any) {
      if (/already starts on that date/.test(error.message)) {
        res.status(409).json({ error: 'Conflict', message: error.message });
        return;
      }
      logger.error('Error updating project rate:', error);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  };

  /**
   * DELETE /api/projects/rates/:rateId
   */
  deleteRate = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { error, value } = projectRateIdSchema.validate(req.params);
      if (error) {
        res.status(400).json({ error: 'Validation error', details: error.details });
        return;
      }

      const deleted = await projectRateService.deleteRate(value.rateId, userId);
      if (!deleted) {
        res.status(404).json({ error: 'Not found', message: 'Rate not found' });
        return;
      }

      res.status(204).send();
    } catch (error: any) {
      logger.error('Error deleting project rate:', error);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  };
}

export const projectRateController = new ProjectRateController();
