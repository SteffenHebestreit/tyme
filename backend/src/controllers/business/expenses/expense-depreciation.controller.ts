/**
 * @fileoverview Expense depreciation (AfA) endpoints: AI analysis, settings
 * update, and schedule retrieval.
 * @module controllers/business/expenses/expense-depreciation
 */

import { Request, Response } from 'express';
import { ExpenseService } from '../../../services/business/expense.service';
import { AIDepreciationService } from '../../../services/financial/ai-depreciation.service';
import { analyzeDepreciationDraftSchema } from '../../../schemas/business/expense.schema';
import { logger } from '../../../utils/logger';

export class ExpenseDepreciationController {
  private expenseService: ExpenseService;

  constructor() {
    this.expenseService = new ExpenseService();
  }

  /**
   * Analyze expense for depreciation using AI
   * POST /api/expenses/:id/analyze-depreciation
   */
  analyzeDepreciation = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      // Get expense details
      const expense = await this.expenseService.getExpenseById(id, userId);
      if (!expense) {
        res.status(404).json({ error: 'Expense not found' });
        return;
      }

      // Check if expense is eligible for depreciation analysis
      // NOTE: We analyze ALL expenses now, not just those > 800€
      // Reasons:
      // 1. Insurance expenses need tax deductibility analysis (even if < 800€)
      // 2. AI can determine if it's an asset (GWG rules) or operating expense
      // 3. Operating expenses are always immediately deductible
      const netAmount = parseFloat(expense.net_amount?.toString() || '0');

      // Clear any previously saved AI analysis when re-analyzing
      logger.info(`[Depreciation] Clearing previous AI analysis for expense ${id}`);
      await this.expenseService.clearAIAnalysis(userId, id);

      // Analyze with AI - let AI determine treatment
      logger.info(`[Depreciation] Analyzing expense ${id} with AI for user ${userId}`);

      // Initialize AI service with user settings.
      // Per-request instance — the service holds per-user client/model state.
      const aiDepreciationService = new AIDepreciationService();
      await aiDepreciationService.initialize(userId);

      const analysis = await aiDepreciationService.analyzeExpense({
        id: expense.id,
        description: expense.description || '',
        notes: expense.notes || '', // Include notes for better context
        category: expense.category || '',
        amount: parseFloat(expense.amount?.toString() || '0'),
        net_amount: netAmount,
        tax_amount: parseFloat(expense.tax_amount?.toString() || '0'),
        tax_rate: parseFloat(expense.tax_rate?.toString() || '0'),
        expense_date: expense.expense_date || new Date().toISOString(),
      });

      // DON'T save to database - let user decide to accept or reject
      // Only save when user explicitly clicks "Accept Recommendation"

      const formattedResponse = this.formatAnalysis(analysis, netAmount, expense.category);

      // Save the AI analysis response to database so it can be displayed when reopening the expense
      logger.info(`[Depreciation] Saving AI analysis response for expense ${id}`);
      await this.expenseService.saveAIAnalysis(userId, id, formattedResponse.analysis);

      res.status(200).json(formattedResponse);
    } catch (error: any) {
      logger.error('[Depreciation] Analysis error:', error);

      // Clear AI analysis on failure
      const { id } = req.params;
      const userId = req.user?.id;
      if (userId && id) {
        try {
          await this.expenseService.clearAIAnalysis(userId, id);
          logger.info(`[Depreciation] Cleared AI analysis for expense ${id} after failure`);
        } catch (clearError) {
          logger.error('[Depreciation] Failed to clear AI analysis:', clearError);
        }
      }

      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  };

  /**
   * Shape an AIDepreciationService result into the response the frontend's
   * DepreciationAnalysis interface expects. Shared by the saved-expense and
   * draft endpoints so the two can never drift apart.
   */
  private formatAnalysis(analysis: any, netAmount: number, fallbackCategory?: string) {
    // Map old/deprecated category names to new ones
    const categoryMapping: { [key: string]: string } = {
      'hardware': 'computer', // Old "hardware" → new "computer"
      'office_supply': 'office_supplies',
      'professional_service': 'professional_services',
      'telecommunication': 'telecommunications',
      'vehicle': 'vehicle_car',
    };

    const suggestedCategory = analysis.suggested_category
      ? (categoryMapping[analysis.suggested_category] || analysis.suggested_category)
      : fallbackCategory;

    // Transform AI response to match frontend interface
    return {
      eligible: true,
      analysis: {
        recommendation: analysis.recommendation,
        depreciation_type: analysis.recommendation,
        depreciation_years: analysis.suggested_years || null,
        useful_life_category: suggestedCategory || 'other', // Use suggested category as asset category
        suggested_category: suggestedCategory,
        category_reasoning: analysis.category_reasoning,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
        tax_impact: {
          first_year_deduction: analysis.tax_deductible_amount,
          deferred_amount: netAmount - analysis.tax_deductible_amount,
        },
        tax_deductible_percentage: analysis.tax_deductible_percentage,
        tax_deductibility_reasoning: analysis.tax_deductibility_reasoning,
        references: analysis.references,
        sources: analysis.sources || [], // Include web search sources
      },
    };
  }

  /**
   * Analyze an unsaved expense for depreciation using AI
   * POST /api/expenses/analyze-depreciation/draft
   *
   * Same analysis as POST /:id/analyze-depreciation, but driven by the values
   * currently in the Add Expense form rather than a stored row. This is what
   * lets the modal offer the AfA analysis directly after the receipt analysis,
   * instead of forcing a save / reopen / analyze round trip. Nothing is
   * persisted — the caller applies the recommendation to the form and saves once.
   */
  analyzeDepreciationDraft = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { error: validationError, value } = analyzeDepreciationDraftSchema.validate(req.body);
      if (validationError) {
        res.status(400).json({ error: 'Validation error', details: validationError.details });
        return;
      }

      logger.info(
        `[Depreciation] Analyzing draft expense "${value.description}" for user ${userId}`
      );

      // Per-request instance — the service holds per-user client/model state.
      const aiDepreciationService = new AIDepreciationService();
      await aiDepreciationService.initialize(userId);

      const analysis = await aiDepreciationService.analyzeExpense({
        id: 'draft',
        description: value.description,
        notes: value.notes || '',
        category: value.category,
        amount: value.amount,
        net_amount: value.net_amount,
        tax_amount: value.tax_amount,
        tax_rate: value.tax_rate,
        expense_date: value.expense_date,
      });

      res.status(200).json(this.formatAnalysis(analysis, value.net_amount, value.category));
    } catch (error: any) {
      logger.error('[Depreciation] Draft analysis error:', {
        message: error?.message,
        stack: error?.stack,
      });
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  };

  /**
   * Update depreciation settings for an expense
   * PUT /api/expenses/:id/depreciation
   */
  updateDepreciation = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const {
        depreciation_type,
        depreciation_years,
        depreciation_start_date,
        depreciation_method,
        useful_life_category,
        category, // AI-suggested category
        tax_deductible_percentage,
        tax_deductibility_reasoning,
      } = req.body;

      // Validate required fields for partial depreciation
      if (depreciation_type === 'partial') {
        if (!depreciation_years || !depreciation_start_date) {
          res.status(400).json({
            error: 'depreciation_years and depreciation_start_date are required for partial depreciation',
          });
          return;
        }

        if (depreciation_years < 1 || depreciation_years > 50) {
          res.status(400).json({ error: 'depreciation_years must be between 1 and 50' });
          return;
        }
      }

      // Update depreciation settings
      const updatedExpense = await this.expenseService.updateDepreciationSettings(id, userId, {
        depreciation_type,
        depreciation_years,
        depreciation_start_date: depreciation_start_date ? new Date(depreciation_start_date) : undefined,
        depreciation_method: depreciation_method || 'linear',
        useful_life_category,
        category, // AI-suggested category
        tax_deductible_percentage,
        tax_deductibility_reasoning,
      });

      res.status(200).json(updatedExpense);
    } catch (error: any) {
      logger.error('[Depreciation] Update error:', error);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  };

  /**
   * Get depreciation schedule for an expense
   * GET /api/expenses/:id/depreciation-schedule
   */
  getDepreciationSchedule = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      // Get expense to verify it exists and user owns it
      const expense = await this.expenseService.getExpenseById(id, userId);
      if (!expense) {
        res.status(404).json({ error: 'Expense not found' });
        return;
      }

      // Get depreciation schedule
      const schedule = await this.expenseService.getDepreciationSchedule(id, userId);

      res.status(200).json({
        expense: {
          id: expense.id,
          description: expense.description,
          net_amount: expense.net_amount,
          depreciation_type: expense.depreciation_type,
          depreciation_years: expense.depreciation_years,
          depreciation_start_date: expense.depreciation_start_date,
          tax_deductible_amount: expense.tax_deductible_amount,
        },
        schedule,
      });
    } catch (error: any) {
      logger.error('[Depreciation] Get schedule error:', error);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  };
}
