/**
 * @fileoverview AI-powered Expense Data Extraction Service
 * 
 * Uses OpenAI-compatible APIs (LM Studio, OpenAI, etc.) to extract structured
 * expense data from PDF receipt text extracted by MCP server.
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../../utils/logger';
import { getDbClient } from '../../utils/database';
import { MCPClientService } from './mcp-client.service';

/**
 * Extracted expense data structure
 */
/**
 * A single position on an invoice.
 *
 * Invoices routinely bundle articles that must be booked separately: the GWG
 * threshold of §6 Abs. 2 EStG applies per Wirtschaftsgut, not per invoice, and
 * the AfA useful life differs per article type. Extracting the positions lets
 * the Add Expense modal offer one expense per article instead of collapsing a
 * mixed invoice into one fictitious asset.
 */
export interface ExtractedLineItem {
  /** What this position is — same rules as ExtractedExpenseData.description. */
  description: string;
  /** Number of units on this position, 1 when the invoice does not say. */
  quantity?: number;
  /** Gross price of a single unit, when the invoice states one. */
  unit_amount?: number;
  /** Gross total for this position (unit_amount x quantity). */
  amount: number;
  /** Expense category for this position specifically. */
  category?: string;
  tax_rate?: number;
}

export interface ExtractedExpenseData {
  amount?: number;
  currency?: string;
  date?: string;
  vendor?: string;
  /** Third-party seller on marketplace invoices ("Verkauft von" / "Sold by"). */
  seller?: string;
  invoice_number?: string;
  category?: string;
  /** What was bought — the line shown in the expense overview, never a company name. */
  description?: string;
  tax_amount?: number;
  tax_rate?: number;
  /**
   * The invoice's individual positions. Present with 2+ entries only when the
   * invoice really bundles distinct articles — a single-article invoice returns
   * an empty array so the caller can keep the simple one-expense path.
   */
  line_items?: ExtractedLineItem[];
  confidence?: number;
  raw_text?: string;
}

/**
 * The expense categories the app actually accepts. Must stay in sync with
 * ExpenseCategory in frontend/src/api/types.ts and the category options in
 * AddExpenseModal. The model is constrained to these via a JSON schema enum,
 * and the result is re-checked against this list before it is returned.
 */
const EXPENSE_CATEGORIES = [
  'computer', 'software', 'peripherals', 'storage', 'display', 'printer',
  'office_furniture', 'office_equipment', 'office_supplies',
  'vehicle_car', 'vehicle_motorcycle',
  'camera', 'tools', 'machinery',
  'insurance', 'professional_services', 'marketing', 'utilities', 'travel',
  'meals', 'training', 'rent', 'telecommunications',
  'other',
] as const;

/**
 * JSON schema handed to the model via response_format. Every field is required
 * (nullable where optional) because a strict schema otherwise lets the model
 * silently drop fields.
 */
const EXTRACTION_JSON_SCHEMA = {
  name: 'expense_extraction',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      description: { type: 'string' },
      vendor: { type: 'string' },
      seller: { type: ['string', 'null'] },
      invoice_number: { type: ['string', 'null'] },
      amount: { type: 'number' },
      currency: { type: 'string' },
      date: { type: 'string' },
      tax_amount: { type: ['number', 'null'] },
      tax_rate: { type: ['number', 'null'] },
      category: { type: 'string', enum: [...EXPENSE_CATEGORIES] },
      line_items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            quantity: { type: 'number' },
            unit_amount: { type: 'number' },
            amount: { type: 'number' },
            tax_rate: { type: ['number', 'null'] },
            category: { type: 'string', enum: [...EXPENSE_CATEGORIES] },
          },
          required: ['description', 'quantity', 'unit_amount', 'amount', 'tax_rate', 'category'],
          additionalProperties: false,
        },
      },
    },
    required: [
      'description', 'vendor', 'seller', 'invoice_number', 'amount',
      'currency', 'date', 'tax_amount', 'tax_rate', 'category', 'line_items',
    ],
    additionalProperties: false,
  },
} as const;

/**
 * AI Expense Extraction Service
 * Works with any OpenAI-compatible API (LM Studio, OpenAI, Azure OpenAI, etc.)
 */
export class ExpenseExtractionService {
  private client: AxiosInstance | null = null;
  private mcpClient: MCPClientService | null = null;
  private apiUrl: string | undefined = undefined;
  private apiKey: string | null = null;
  private model: string = 'llama-3.2-3b-instruct';
  private enabled: boolean = false;

  /**
   * Initialize the AI service with settings from database
   */
  async initialize(userId: string): Promise<void> {
    try {
      // Fetch user settings
      const settings = await this.getUserSettings(userId);

      if (!settings || !settings.ai_enabled) {
        logger.info('AI extraction is disabled in settings');
        this.enabled = false;
        return;
      }

      this.enabled = true;
      this.apiUrl = settings.ai_api_url || 'http://localhost:1234/v1';
      this.apiKey = settings.ai_api_key || '';
      this.model = settings.ai_model || 'qwen/qwen3-v1-30b';

      // Initialize MCP client with user's server URL
      const mcpServerUrl = settings.mcp_server_url || 'http://mcp-server:8000';
      this.mcpClient = new MCPClientService(mcpServerUrl);
      logger.info(`MCP client initialized with URL: ${mcpServerUrl}`);

      // Create axios client for OpenAI-compatible API
      this.client = axios.create({
        baseURL: this.apiUrl,
        timeout: 180000, // 3 minutes — large local models can be slow
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` }),
        },
      });

      logger.info(`AI extraction initialized: ${this.apiUrl} (model: ${this.model})`);
    } catch (error: any) {
      logger.error('Failed to initialize AI extraction service:', error.message);
      this.enabled = false;
    }
  }

  /**
   * Get user settings from database
   */
  private async getUserSettings(userId: string): Promise<any> {
    try {
      const pool = getDbClient();
      const result = await pool.query(
        `SELECT 
          ai_enabled,
          ai_provider,
          ai_api_url,
          ai_api_key,
          ai_model,
          mcp_server_url,
          mcp_server_api_key
        FROM settings 
        WHERE user_id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        logger.warn(`No settings found for user ${userId}, using defaults`);
        return {
          ai_enabled: false,
          ai_api_url: 'http://localhost:1234/v1',
          ai_api_key: '',
          ai_model: 'qwen/qwen3-v1-30b',
          mcp_server_url: 'http://mcp-server:8000',
        };
      }

      return result.rows[0];
    } catch (error: any) {
      logger.error(`Failed to load settings for user ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Check if AI extraction is enabled and initialized
   */
  isEnabled(): boolean {
    return this.enabled && this.client !== null;
  }

  /**
   * Extract text from a receipt document using the MCP server.
   *
   * Handles PDFs and images alike — markitdown describes photographed and
   * scanned receipts through its LLM, so a phone snapshot of a till slip goes
   * down the same path as a PDF invoice.
   *
   * @param fileBuffer - Receipt file buffer (PDF or image)
   * @param filename - Original filename; its extension tells the MCP server
   *                   which converter to use, so pass the real one
   * @returns Extracted text
   */
  async extractDocumentText(fileBuffer: Buffer, filename: string): Promise<string> {
    if (!this.mcpClient) {
      throw new Error('MCP client is not initialized');
    }

    return await this.mcpClient.extractDocumentText(fileBuffer, filename);
  }

  /**
   * Extract expense data from text using AI
   * 
   * @param text - Extracted text from PDF receipt
   * @returns Structured expense data
   */
  async extractExpenseData(text: string): Promise<ExtractedExpenseData> {
    if (!this.isEnabled()) {
      throw new Error('AI extraction is not enabled or initialized');
    }

    try {
      logger.info(`Extracting expense data from ${text.length} characters of text`);

      // Create structured prompt for expense extraction
      const prompt = this.buildExtractionPrompt(text);

      // Call OpenAI-compatible API
      try {
        const completion = await this.requestCompletion(prompt);

        // Robustly extract JSON — strip <think> blocks, markdown fences, and any leading/trailing text
        const jsonString = this.extractJsonFromResponse(completion);

        const extractedData = this.normalizeExtractedData(JSON.parse(jsonString));

        // Add confidence score and raw text
        const result: ExtractedExpenseData = {
          ...extractedData,
          confidence: this.calculateConfidence(extractedData),
          raw_text: text.substring(0, 500), // Store first 500 chars for reference
        };

        logger.info(`Successfully extracted expense data: ${JSON.stringify(result)}`);
        return result;
      } catch (apiError: any) {
        logger.error('AI API error:', apiError.response?.data || apiError.message);
        throw apiError;
      }
    } catch (error: any) {
      logger.error('Failed to extract expense data:', error.message);
      throw new Error(`AI extraction failed: ${error.message}`);
    }
  }

  /**
   * Ask the model for the extraction, constraining it to EXTRACTION_JSON_SCHEMA.
   *
   * Servers that speak the OpenAI structured-output dialect (LM Studio, OpenAI,
   * vLLM, …) then cannot return anything but a conforming object, which is what
   * keeps `description` and `vendor` from swapping places. Servers that reject
   * `response_format` are retried once without it, falling back to the
   * prose-scraping path in extractJsonFromResponse().
   *
   * @returns The raw completion text (already JSON when the schema was accepted)
   */
  private async requestCompletion(prompt: string): Promise<string> {
    const basePayload = {
      model: this.model,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert at extracting structured bookkeeping data from receipts and invoices. Return a single JSON object and nothing else.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      // Reasoning models (Qwen3, gpt-oss, …) spend most of this budget on
      // hidden reasoning before emitting a single token of answer — an ordinary
      // one-page invoice was measured at ~2.3k reasoning tokens, so a 4k cap
      // truncated longer documents mid-thought and yielded an empty `content`.
      max_tokens: 12000,
    };

    let response;
    try {
      response = await this.client!.post('/chat/completions', {
        ...basePayload,
        response_format: { type: 'json_schema', json_schema: EXTRACTION_JSON_SCHEMA },
      });
    } catch (error: any) {
      if (error.response?.status !== 400) throw error;
      logger.warn(
        `AI endpoint rejected response_format json_schema, retrying unconstrained: ${JSON.stringify(
          error.response?.data
        )}`
      );
      response = await this.client!.post('/chat/completions', basePayload);
    }

    const choice = response.data?.choices?.[0];
    if (!choice) {
      throw new Error(
        `AI response contained no choices: ${JSON.stringify(response.data).substring(0, 200)}`
      );
    }

    // Reasoning models split their output: hidden reasoning goes to
    // reasoning_content, the answer to content. Only fall back to the reasoning
    // when content is empty (model ran out of budget mid-thought).
    const message = choice.message ?? {};
    const completion: string = message.content || message.reasoning_content || '';

    if (!completion.trim() && choice.finish_reason === 'length') {
      throw new Error(
        'AI model exhausted its token budget while reasoning and produced no answer. ' +
          'Try a smaller receipt or a non-reasoning model.'
      );
    }

    logger.info(
      `AI response: ${completion.length} chars (finish_reason=${choice.finish_reason})`
    );
    return completion;
  }

  /**
   * Coerce the model's output into the shapes the expense form expects.
   *
   * Guards the two things a free-form model reliably gets wrong even under a
   * schema: German number/date formatting, and a category outside the app's
   * enum (which the form's select would silently refuse to display).
   */
  private normalizeExtractedData(raw: any): ExtractedExpenseData {
    const data: ExtractedExpenseData = { ...raw };

    data.amount = this.toNumber(raw.amount);
    data.tax_amount = this.toNumber(raw.tax_amount);
    data.tax_rate = this.toNumber(raw.tax_rate);

    // A percentage slipped through as 19 instead of 0.19
    if (data.tax_rate !== undefined && data.tax_rate > 1) {
      data.tax_rate = data.tax_rate / 100;
    }

    data.date = this.toIsoDate(raw.date);

    if (!data.category || !(EXPENSE_CATEGORIES as readonly string[]).includes(data.category)) {
      if (data.category) {
        logger.warn(`AI returned unknown expense category "${data.category}", dropping it`);
      }
      delete data.category;
    }

    data.line_items = this.normalizeLineItems(raw.line_items, data.category);

    for (const key of ['description', 'vendor', 'seller', 'invoice_number', 'currency'] as const) {
      const value = (data as any)[key];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          (data as any)[key] = trimmed;
        } else {
          delete (data as any)[key];
        }
      } else if (value === null) {
        delete (data as any)[key];
      }
    }

    return data;
  }

  /**
   * Clean up the extracted invoice positions.
   *
   * Drops anything without a usable description and amount (zero-value shipping
   * rows, hallucinated placeholders), and falls back to the invoice-level
   * category when a position's own category is not one the app accepts.
   * Returns an empty array for single-article invoices so callers can keep the
   * plain one-expense path.
   */
  private normalizeLineItems(raw: any, fallbackCategory?: string): ExtractedLineItem[] {
    if (!Array.isArray(raw)) return [];

    const items = raw
      .map((entry: any): ExtractedLineItem | null => {
        const description = typeof entry?.description === 'string' ? entry.description.trim() : '';
        const amount = this.toNumber(entry?.amount);
        if (!description || amount === undefined || amount <= 0) return null;

        const quantity = this.toNumber(entry?.quantity);
        const unitAmount = this.toNumber(entry?.unit_amount);
        let taxRate = this.toNumber(entry?.tax_rate);
        if (taxRate !== undefined && taxRate > 1) taxRate = taxRate / 100;

        const category =
          typeof entry?.category === 'string' &&
          (EXPENSE_CATEGORIES as readonly string[]).includes(entry.category)
            ? entry.category
            : fallbackCategory;

        return {
          description,
          quantity: quantity && quantity > 0 ? quantity : 1,
          unit_amount: unitAmount,
          amount,
          category,
          tax_rate: taxRate,
        };
      })
      .filter((item): item is ExtractedLineItem => item !== null);

    // A single position carries no more information than the invoice itself.
    return items.length > 1 ? items : [];
  }

  /**
   * Parse a number that may arrive as a German-formatted string ("1.234,56 €").
   */
  private toNumber(value: any): number | undefined {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value !== 'string') return undefined;

    let cleaned = value.replace(/[^\d.,-]/g, '').trim();
    if (!cleaned) return undefined;

    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastComma > lastDot) {
      // German: dots group thousands, comma is the decimal separator
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }

    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  /**
   * Normalise a date to YYYY-MM-DD, accepting the DD.MM.YYYY and DD/MM/YYYY
   * forms that German and European invoices use.
   */
  private toIsoDate(value: any): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

    const euro = trimmed.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (euro) {
      const [, day, month, year] = euro;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    logger.warn(`AI returned an unparseable date "${trimmed}", dropping it`);
    return undefined;
  }

  /**
   * Robustly extract a JSON object from an AI response.
   * Handles: <think>...</think> blocks, ```json fences, leading prose.
   */
  private extractJsonFromResponse(raw: string): string {
    if (!raw || !raw.trim()) {
      throw new Error('Empty response from AI model');
    }

    let text = raw;

    // Strip <think>...</think> blocks (Qwen3 / chain-of-thought models)
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // Strip markdown code fences
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    // Find the first complete JSON object {…} or array […]
    const openBrace = text.indexOf('{');
    const openBracket = text.indexOf('[');
    const start = openBrace === -1 ? openBracket
                : openBracket === -1 ? openBrace
                : Math.min(openBrace, openBracket);

    if (start === -1) {
      throw new Error(`No JSON object found in AI response: ${text.substring(0, 200)}`);
    }

    const closeChar = text[start] === '{' ? '}' : ']';
    const end = text.lastIndexOf(closeChar);

    if (end === -1 || end <= start) {
      throw new Error(`Malformed JSON in AI response: ${text.substring(0, 200)}`);
    }

    return text.substring(start, end + 1);
  }

  /**
   * Build extraction prompt for the AI model
   */
  private buildExtractionPrompt(text: string): string {
    return `You extract structured bookkeeping data from a receipt or invoice.

Return ONLY a JSON object with these fields:

- description: A short label (max 80 characters) saying WHAT WAS BOUGHT — the goods
  or the service itself. This is the single line shown in the user's expense
  overview, so it has to be meaningful on its own.
  * Take it from the line item / product / service description.
  * NEVER put a company name here — not the merchant, not the marketplace, and not
    the third-party seller. Those belong in "vendor" and "seller".
  * Strip marketing filler, compatibility lists, colour variants and article
    numbers (ASIN, SKU, EAN). Keep the brand and the essential product type,
    e.g. "ProtoArc XK01 Bluetooth-Tastatur", not the full 200-character listing title.
  * With several line items, summarise them, e.g. "Büromaterial: Toner, Papier, Ordner".
  * Write it in the language of the invoice.
- vendor: The company the money was paid to — the merchant, marketplace or issuer
  of the invoice. On a marketplace invoice this is the marketplace (e.g. Amazon),
  not the third-party seller.
- seller: The third-party seller when the invoice names one separately
  ("Verkauft von" / "Sold by"). null when it is the same as vendor.
- invoice_number: The invoice or receipt number ("Rechnungsnummer"), else null.
- amount: The total gross amount actually paid, as a number with . as the decimal
  separator. German invoices use the opposite convention, so read carefully:
  "51,99 €" is 51.99 and "1.234,56 €" is 1234.56. Take the final total
  ("Gesamtpreis" / "Zahlbetrag" / "Total"), not a line-item subtotal.
- currency: ISO 4217 code, e.g. "EUR", "USD".
- date: The invoice date ("Rechnungsdatum") as YYYY-MM-DD. German dates are
  DD.MM.YYYY, so 02.03.2026 is 2026-03-02 — not 2026-02-03.
- tax_amount: The VAT amount ("USt." / "MwSt.") as a number, else null.
- tax_rate: The VAT rate as a decimal — 19% is 0.19, not 19 — else null.
- category: EXACTLY ONE of these values, nothing else:
  ${EXPENSE_CATEGORIES.join(', ')}
  Pick the most specific fit:
  * keyboards, mice, headsets, webcams, docking stations, cables -> peripherals
  * laptops, tablets, desktop PCs, servers -> computer
  * monitors, projectors -> display
  * external drives, USB sticks, SD cards -> storage
  * licences, subscriptions, SaaS, hosting -> software
  Use "other" only when genuinely nothing fits.
- line_items: The invoice's individual positions, as an array.
  This matters for tax: the 800 EUR GWG limit applies per article, not per
  invoice, and different article types have different depreciation periods, so a
  mixed invoice has to be bookable as separate expenses.
  * Return one entry per position of the invoice, each with:
    - description: what that position is, same rules as above (no company names,
      no article numbers, keep brand + product type)
    - quantity: number of units on that position (1 when not stated)
    - unit_amount: gross price of ONE unit
    - amount: gross total for that position (unit_amount x quantity)
    - tax_rate: that position's VAT rate as a decimal, else null
    - category: the category for THAT position, from the list above
  * Use gross (inkl. USt.) prices. If the invoice lists only net prices, apply
    that position's VAT rate to get the gross value.
  * Ignore zero-value positions such as "Versandkosten 0,00 EUR".
  * The position totals must add up to "amount" above. Re-check before answering.
  * Return an EMPTY array when the invoice covers only a single article — the
    caller then just books the one expense.

The top-level "description", "amount" and "category" always describe the invoice
as a whole, even when line_items is populated.

Receipt text:
${text}

Return the JSON object and nothing else — no explanation, no markdown fences.`;
  }

  /**
   * Calculate confidence score based on extracted data completeness
   */
  private calculateConfidence(data: Partial<ExtractedExpenseData>): number {
    let score = 0;
    const weights = {
      amount: 30,
      date: 25,
      vendor: 20,
      category: 15,
      currency: 10,
    };

    if (data.amount && data.amount > 0) score += weights.amount;
    if (data.date && this.isValidDate(data.date)) score += weights.date;
    if (data.vendor && data.vendor.length > 0) score += weights.vendor;
    if (data.category && data.category.length > 0) score += weights.category;
    if (data.currency && data.currency.length > 0) score += weights.currency;

    return Math.min(score, 100);
  }

  /**
   * Validate date format (YYYY-MM-DD)
   */
  private isValidDate(dateString: string): boolean {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) return false;
    
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
  }
}

// Export singleton instance
export const expenseExtractionService = new ExpenseExtractionService();
