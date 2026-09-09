/**
 * @fileoverview AI-powered Depreciation Analysis Service (AfA)
 * 
 * Enhanced with comprehensive German tax law context, AfA tables,
 * and support for multiple AI providers.
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../../utils/logger';
import { getDbClient } from '../../utils/database';
import { mcpClient } from '../mcp/mcp-client.service';

export interface DepreciationAnalysis {
  recommendation: 'none' | 'immediate' | 'partial';
  reasoning: string;
  suggested_years?: number;
  useful_life_category?: string;
  suggested_category?: string; // AI-suggested expense category (computer, software, insurance, etc.)
  category_reasoning?: string; // Why this category was suggested
  tax_deductible_amount: number;
  tax_deductible_percentage: number; // 0-100, percentage that is tax-deductible
  tax_deductibility_reasoning: string; // Why this percentage is/isn't fully deductible
  references?: string[];
  sources?: Array<{ title: string; url: string }>; // Web sources used for analysis
  confidence: number;
  gwg_applicable?: boolean;
  requires_depreciation?: boolean;
}

export interface ExpenseForAnalysis {
  id: string;
  description: string;
  notes?: string; // Additional context/details about the expense
  category: string;
  amount: number;
  net_amount: number;
  tax_amount: number;
  tax_rate: number;
  expense_date: string;
}

const AfA_TABLE: { [key: string]: number } = {
  // IT Equipment (seit 2021: 1 Jahr statt 3 Jahre!)
  'computer': 1, 'laptop': 1, 'tablet': 1, 'printer': 1, 'scanner': 1,
  'router': 1, 'server': 1, 'software': 1, 'monitor': 1, 'peripherie': 1,
  'tastatur': 1, 'maus': 1, 'headset': 1, 'mikrofon': 1, 'webcam': 1,
  'festplatte': 1, 'usb': 1, 'docking': 1, 'beamer': 1, 'display': 1,
  
  // Office Furniture
  'desk': 13, 'chair': 13, 'cabinet': 13, 'furniture': 13,
  
  // Other Equipment
  'phone_system': 5, 'coffee_machine': 5, 'air_conditioning': 10,
  'car': 6, 'pkw': 6, 'motorcycle': 7, 'bicycle': 7, 'ebike': 7,
  'camera': 7, 'projector': 7, 'hand_tools': 5, 'kopiergerät': 7,
};

export class AIDepreciationService {
  private client: AxiosInstance | null = null;
  private apiUrl: string | undefined = undefined;
  private apiKey: string | null = null;
  private model: string = 'qwen/qwen3-v1-30b';
  private provider: string = 'local';
  private enabled: boolean = false;
  private userId: string | null = null;

  async initialize(userId: string): Promise<void> {
    try {
      this.userId = userId;
      const settings = await this.getUserSettings(userId);

      if (!settings || !settings.ai_enabled) {
        logger.info('AI depreciation analysis is disabled');
        this.enabled = false;
        return;
      }

      this.enabled = true;
      this.provider = settings.ai_provider || 'local';
      this.apiUrl = settings.ai_api_url || 'http://localhost:1234/v1';
      this.apiKey = settings.ai_api_key || '';
      this.model = settings.ai_model || 'qwen/qwen3-v1-30b';

      this.client = axios.create({
        baseURL: this.apiUrl,
        timeout: 60000,
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'Authorization': `Bearer \${this.apiKey}` }),
        },
      });

      logger.info(`AI depreciation init: \${this.provider} at \${this.apiUrl}`);
    } catch (error: any) {
      logger.error('Failed to initialize AI depreciation service:', error.message);
      this.enabled = false;
    }
  }

  private async getUserSettings(userId: string): Promise<any> {
    try {
      const pool = getDbClient();
      const result = await pool.query(
        `SELECT ai_enabled, ai_provider, ai_api_url, ai_api_key, ai_model
        FROM settings WHERE user_id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return {
          ai_enabled: false,
          ai_provider: 'local',
          ai_api_url: 'http://localhost:1234/v1',
          ai_model: 'qwen/qwen3-v1-30b',
        };
      }

      return result.rows[0];
    } catch (error: any) {
      logger.error('Error fetching user settings:', error.message);
      return null;
    }
  }

  async analyzeExpense(expense: ExpenseForAnalysis, retryCount: number = 0): Promise<DepreciationAnalysis> {
    if (!this.enabled || !this.client) {
      logger.warn('AI service not enabled or initialized, using defaults');
      return this.basicDepreciationRules(expense);
    }

    const MAX_RETRIES = 3; // Increased to 3 retries (4 total attempts) for better reliability

    try {
      // MANDATORY: Always perform web research to validate recommendations
      logger.info('[AI Analysis] Starting web research for expense:', expense.description);
      let additionalContext = '';
      let searchSources: Array<{ title: string; url: string }> = [];
      const description = expense.description.toLowerCase();
      
      // Build search context from description and notes
      const searchContext = expense.notes 
        ? `${expense.description} ${expense.notes}` 
        : expense.description;
      
      // STEP 1: Search for depreciation/AfA information
      logger.info('[Web Search] Step 1: Searching for AfA/depreciation rules');
      const afaSearchQuery = `${searchContext} ${expense.category} AfA Nutzungsdauer Abschreibung Steuerrecht`;
      const afaSearchResult = await this.executeWebSearch(afaSearchQuery);
      const afaParsed = JSON.parse(afaSearchResult);
      additionalContext = afaParsed.content;
      searchSources = afaParsed.sources || [];
      
      // STEP 2: For high-value expenses or specific models, fetch detailed content
      const hasSpecificModel = /[A-Z]{2,}\s+[A-Z0-9]{2,}/i.test(expense.description);
      if (expense.net_amount >= 800 || hasSpecificModel) {
        logger.info('[Web Search] Step 2: High-value or specific model, fetching detailed information');
        
        // Fetch content from top source if available
        if (searchSources.length > 0 && searchSources[0].url) {
          try {
            const fetchResult = await mcpClient.callTool('gateway', 'fetch_content', {
              url: searchSources[0].url
            });
            
            if (fetchResult.content && Array.isArray(fetchResult.content)) {
              const fetchedContent = fetchResult.content
                .filter((item: any) => item.type === 'text')
                .map((item: any) => item.text)
                .join('\n');
              
              if (fetchedContent) {
                additionalContext += `\n\n# DETAILED SOURCE CONTENT:\n${fetchedContent.substring(0, 2000)}`;
                logger.info('[Web Search] Fetched and appended detailed content from source');
              }
            }
          } catch (fetchError: any) {
            logger.warn('[Web Search] Failed to fetch detailed content:', fetchError.message);
          }
        }
      }
      
      // STEP 3: For insurance, add specific deductibility search
      const fullText = `${description} ${expense.notes || ''}`.toLowerCase();
      if (fullText.includes('versicherung') || fullText.includes('insurance')) {
        logger.info('[Web Search] Step 3: Insurance detected, searching for tax deductibility rules');
        const insuranceQuery = `${searchContext} steuerliche Absetzbarkeit Betriebsausgabe`;
        const insuranceResult = await this.executeWebSearch(insuranceQuery);
        const insuranceParsed = JSON.parse(insuranceResult);
        additionalContext += `\n\n# INSURANCE TAX DEDUCTIBILITY:\n${insuranceParsed.content}`;
        searchSources = [...searchSources, ...(insuranceParsed.sources || [])];
      }
      
      logger.info(`[Web Search] Research complete: ${searchSources.length} sources found`);
      if (searchSources.length > 0) {
        logger.info('[Web Search] Top sources:', searchSources.slice(0, 3).map(s => s.url));
      }
      
      const prompt = await this.buildAnalysisPrompt(expense, additionalContext, searchSources);
      
      let response;
      
      if (this.provider === 'openai' || this.provider === 'local' || this.provider === 'lm_studio') {
        // Simplified: No function calling, just direct analysis with context
        response = await this.client.post('/chat/completions', {
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are a German tax law expert specialized in asset depreciation (AfA - Absetzung für Abnutzung) according to § 7 EStG. CRITICAL: You MUST respond with ONLY valid JSON - no text before or after, no markdown code blocks, no explanations. Ensure all JSON is properly formatted with correct commas, quotes, and brackets. WICHTIG: Computer/IT-Geräte haben seit 2021 nur 1 Jahr Nutzungsdauer!',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.1,
          // Reasoning models (Qwen3, gpt-oss, …) spend this budget on hidden
          // reasoning before emitting a single token of answer. At 800 the
          // budget was exhausted mid-thought on every attempt: content came
          // back empty, all retries failed, and the service silently fell
          // through to basicDepreciationRules() — so the AI analysis never
          // actually ran on a reasoning model.
          max_tokens: 12000,
        });
      } else if (this.provider === 'claude' || this.provider === 'anthropic') {
        // Claude/Anthropic API format
        response = await this.client.post('/messages', {
          model: this.model,
          max_tokens: 1500,
          system: 'You are a German tax law expert specialized in asset depreciation (AfA - Absetzung für Abnutzung) according to § 7 EStG. CRITICAL: You MUST respond with ONLY valid JSON - no text before or after, no markdown code blocks, no explanations. Ensure all JSON is properly formatted with correct commas, quotes, and brackets. WICHTIG: Computer/IT-Geräte haben seit 2021 nur 1 Jahr Nutzungsdauer!',
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.1,
        });
      } else {
        logger.error(`Unsupported AI provider: ${this.provider}`);
        return this.basicDepreciationRules(expense);
      }

      const aiResponse = this.extractAIContent(response.data);
      if (!aiResponse) {
        logger.warn('Could not extract content from AI response');
        logger.debug('Full AI response:', JSON.stringify(response.data, null, 2));
        if (retryCount < MAX_RETRIES) {
          logger.info(`Retrying AI analysis (${retryCount + 1}/${MAX_RETRIES})...`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
          return this.analyzeExpense(expense, retryCount + 1);
        }
        return this.basicDepreciationRules(expense);
      }
      
      // Check if AI is still trying to call tools (Qwen format)
      if (aiResponse.includes('<tool_call>')) {
        logger.warn('AI response still contains tool calls after execution, extracting JSON if present');
        // Try to find JSON outside of tool_call tags
        const withoutToolCalls = aiResponse.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
        if (withoutToolCalls && withoutToolCalls.includes('{')) {
          logger.info('Found JSON content outside tool calls');
          // Use the content without tool calls
          return this.parseAIResponse(withoutToolCalls, expense);
        }
        
        logger.error('AI keeps trying to call tools, falling back to basic rules');
        return this.basicDepreciationRules(expense);
      }

      // Parse AI response
      let analysis: DepreciationAnalysis | null = null;
      try {
        analysis = this.parseAIResponse(aiResponse, expense);
      } catch (parseError: any) {
        logger.error('Failed to parse AI response:', parseError.message);
        if (retryCount < MAX_RETRIES) {
          logger.info(`Retrying AI analysis due to parse error (${retryCount + 1}/${MAX_RETRIES})...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return this.analyzeExpense(expense, retryCount + 1);
        }
        return this.basicDepreciationRules(expense);
      }
      
      // If confidence < 85% and not a known asset, trigger web research
      if (analysis && analysis.confidence < 0.85) {
        logger.info(`Low confidence (${analysis.confidence}), should trigger DuckDuckGo search for: ${expense.description}`);
        // TODO: Implement DuckDuckGo MCP integration for uncertain asset types
      }
      
      return analysis || this.basicDepreciationRules(expense);
    } catch (error: any) {
      logger.error('Failed to analyze expense with AI:', error.message);
      logger.debug('Full error details:', error.response?.data || error.stack);
      if (retryCount < MAX_RETRIES) {
        logger.info(`Retrying AI analysis after error (${retryCount + 1}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.analyzeExpense(expense, retryCount + 1);
      }
      return this.basicDepreciationRules(expense);
    }
  }

  /**
   * Extract AI response content based on provider format
   */
  private extractAIContent(responseData: any): string | null {
    // OpenAI format
    if (responseData.choices && responseData.choices[0]?.message?.content) {
      return responseData.choices[0].message.content;
    }
    
    // Claude format
    if (responseData.content && responseData.content[0]?.text) {
      return responseData.content[0].text;
    }
    
    return null;
  }

  private async executeWebSearch(query: string): Promise<string> {
    try {
      logger.info(`[Web Search] Executing search via MCP Gateway: ${query}`);
      
      // Check if MCP Gateway is available
      if (!mcpClient.isConnected()) {
        logger.warn('[Web Search] MCP Gateway not connected, using fallback');
        return JSON.stringify({
          content: await this.getKnowledgeBasedAnswer(query),
          sources: this.getDefaultSources(query)
        });
      }

      // Use MCP Gateway for DuckDuckGo search
      const searchResponse = await mcpClient.callTool('gateway', 'search', {
        query,
        max_results: 5
      });

      logger.info('[Web Search] MCP Gateway search response received');
      logger.debug('[Web Search] Response:', searchResponse);

      let content = '';
      const sources: Array<{ title: string; url: string }> = [];

      // Parse MCP response content
      if (searchResponse.content && Array.isArray(searchResponse.content)) {
        for (const item of searchResponse.content) {
          if (item.type === 'text') {
            content += item.text + '\n';
          } else if (item.type === 'resource' && item.resource) {
            // Extract resource information
            sources.push({
              title: item.resource.name || item.resource.uri || 'Resource',
              url: item.resource.uri || item.resource.url || ''
            });
          }
        }
      } else if (typeof searchResponse.content === 'string') {
        content = searchResponse.content;
      }

      // Extract URLs from content text using regex
      const urlRegex = /https?:\/\/[^\s)]+/g;
      const urls = content.match(urlRegex) || [];
      
      // Add URLs as sources if we don't have enough
      if (sources.length < 3) {
        urls.slice(0, 5 - sources.length).forEach((url, index) => {
          // Avoid duplicates
          if (!sources.find(s => s.url === url)) {
            sources.push({
              title: `Source ${sources.length + index + 1}`,
              url: url
            });
          }
        });
      }

      if (content && sources.length > 0) {
        logger.info(`[Web Search] Search successful: ${content.length} chars, ${sources.length} sources`);
        return JSON.stringify({ content, sources });
      }

      // Fallback if no results
      logger.warn('[Web Search] No results from MCP search, using fallback');
      return JSON.stringify({
        content: await this.getKnowledgeBasedAnswer(query),
        sources: this.getDefaultSources(query)
      });
      
    } catch (error: any) {
      logger.error('[Web Search] Search failed:', error.message);
      logger.info('[Web Search] Using fallback knowledge base');
      return JSON.stringify({
        content: await this.getKnowledgeBasedAnswer(query),
        sources: this.getDefaultSources(query)
      });
    }
  }
  
  private getDefaultSources(query: string): Array<{ title: string; url: string }> {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('afa') || lowerQuery.includes('depreciation') || lowerQuery.includes('nutzungsdauer')) {
      return [{
        title: 'BMF AfA-Tabelle für allgemein verwendbare Anlagegüter',
        url: 'https://www.bundesfinanzministerium.de/Content/DE/Standardartikel/Themen/Steuern/Weitere_Steuerthemen/Betriebspruefung/AfA-Tabellen/afa-tabellen.html'
      }];
    }
    
    if (lowerQuery.includes('versicherung') || lowerQuery.includes('insurance')) {
      return [{
        title: 'Betriebsausgaben § 4 Abs. 4 EStG',
        url: 'https://www.gesetze-im-internet.de/estg/__4.html'
      }];
    }
    
    return [{
      title: 'Einkommensteuergesetz (EStG)',
      url: 'https://www.gesetze-im-internet.de/estg/'
    }];
  }
  
  private getKnowledgeBasedAnswer(query: string): string {
    const lowerQuery = query.toLowerCase();
    
    // Check for specific vehicle models
    if (lowerQuery.includes('kia ev9') || lowerQuery.includes('kia ev 9')) {
      return `KIA EV9 Information:
• KIA EV9 ist ein vollelektrisches SUV (Elektrofahrzeug)
• Kategorie: Fahrzeug (PKW) - 6 Jahre AfA Nutzungsdauer
• Versicherung: KFZ-Versicherung ist Betriebsausgabe (operating expense), keine AfA nötig
• Steuerliche Absetzbarkeit: Abhängig vom betrieblichen Nutzungsanteil
  - 100% Geschäftsnutzung = 100% absetzbar
  - 50% Geschäftsnutzung = 50% absetzbar (Fahrtenbuch oder 1% Regelung)
  - < 50% private Nutzung = entsprechend reduziert absetzbar
• Typische Geschäftsnutzung bei Freiberuflern: 50-80%`;
    }
    
    // General car insurance info
    if (lowerQuery.includes('kfz-versicherung') || lowerQuery.includes('versicherung') && lowerQuery.includes('auto')) {
      return `KFZ-Versicherung (Car Insurance) - Tax Deductibility:
• Type: Operating expense (Betriebsausgabe), NOT an asset
• Depreciation: Immediate deduction (Sofortabschreibung)
• Tax Deductibility: Depends on business vs. private use
  - 100% business vehicle: 100% deductible
  - Mixed use (Fahrtenbuch): Percentage based on business km / total km
  - Mixed use (1% Regelung): Typically 50-80% deductible for self-employed
  - < 10% business use: Not deductible
• Default estimate for self-employed/freelancers: 60% deductible
• Recommendation: Use actual Fahrtenbuch (mileage log) for accurate percentage`;
    }
    
    // Professional liability insurance
    if (lowerQuery.includes('berufshaftpflicht') || lowerQuery.includes('betriebshaftpflicht')) {
      return `Berufshaftpflicht/Betriebshaftpflicht (Professional Liability Insurance):
• Type: Operating expense, immediate deduction
• Tax Deductibility: 100% (fully deductible as business expense)
• Reasoning: Exclusively for business purposes
• § Reference: § 4 Abs. 4 EStG (Betriebsausgaben)`;
    }
    
    // Health insurance
    if (lowerQuery.includes('krankenversicherung') || lowerQuery.includes('health insurance')) {
      return `Krankenversicherung (Health Insurance):
• Type: Operating expense
• Tax Deductibility: Generally 0% as business expense
• Exception: Special business-related health insurance may be partially deductible
• Note: Can be deducted as Sonderausgaben (special expenses) in personal tax return, but NOT as business expense`;
    }
    
    // Generic insurance
    if (lowerQuery.includes('versicherung') || lowerQuery.includes('insurance')) {
      return `Insurance (Versicherung) - General Guidelines:
• Type: Operating expense, NOT an asset
• Depreciation: Always immediate deduction (Sofortabschreibung)
• Category: "insurance"
• Tax Deductibility varies by type:
  - Business insurance (Berufshaftpflicht): 100%
  - Vehicle insurance (KFZ): 50-80% depending on business use
  - Professional equipment insurance: 100%
  - Private health/life insurance: 0% (not a business expense)
• Recommendation: Estimate based on business use percentage`;
    }
    
    return `Unable to find specific information. General guidelines:
• Insurance = operating expense, immediate deduction, category "insurance"
• Estimate tax deductibility based on business vs. private use
• 100% business purpose = 100% deductible
• Mixed use = proportional deductibility`;
  }

  private async buildAnalysisPrompt(
    expense: ExpenseForAnalysis, 
    additionalContext: string = '',
    searchSources: Array<{ title: string; url: string }> = []
  ): Promise<string> {
    const purchaseDate = new Date(expense.expense_date);
    const purchaseMonth = purchaseDate.getMonth() + 1;
    const monthsOwned = 13 - purchaseMonth;
    
    // Check if asset type is known
    const description = expense.description.toLowerCase();
    const category = expense.category.toLowerCase();
    const knownCategories = Object.keys(AfA_TABLE);
    const isKnownAsset = knownCategories.some(cat => 
      description.includes(cat) || category.includes(cat)
    );

    const contextSection = additionalContext ? `\n\n# WEB SEARCH RESULTS:\n${additionalContext}\n` : '';
    const sourcesSection = searchSources.length > 0 
      ? `\n\n# VERIFIED SOURCES TO CITE:\n${searchSources.map(s => `- ${s.title}: ${s.url}`).join('\n')}\n` 
      : '';

    return `You are a German tax advisor analyzing business expenses for depreciation and tax deductibility.${contextSection}${sourcesSection}

# EXPENSE TO ANALYZE:
Description: "${expense.description}"
${expense.notes ? `Notes: "${expense.notes}"` : ''}
Category: "${expense.category}"
Net Amount: ${expense.net_amount}€
Date: ${expense.expense_date}

**IMPORTANT: Analyze THIS specific expense based on its actual description${expense.notes ? ', notes,' : ''} and the web search results. Do not use examples as templates.**

# GERMAN TAX LAW (2025)

## STEP 1: IDENTIFY TYPE

**Determine if this is an OPERATING EXPENSE or DEPRECIABLE ASSET:**

OPERATING EXPENSES (immediate deduction, suggested_years = 0):
- Services: consulting, accounting, legal, marketing, subscriptions
- Utilities: electricity, water, internet, telecommunications
- Insurance: any type (Versicherung)
- Consumables: office supplies, materials used up quickly
- Rent, travel, meals, repairs/maintenance

DEPRECIABLE ASSETS (multi-year depreciation, suggested_years > 0):
- Physical items with useful life > 1 year AND cost > 800€
- Examples: computers, furniture, machinery, vehicles
- Must be tangible and provide benefit over multiple years

## STEP 2: DEPRECIATION RULES

For OPERATING EXPENSES:
- recommendation = "immediate"
- suggested_years = 0

For ASSETS (GWG Rules):
- If < 800€: recommendation = "immediate" 
- If ≥ 800€: recommendation = "partial", find years from AfA table

AfA Table (Useful Life):
- IT Equipment (since 2021): 1 year
- Office furniture: 13 years
- Vehicles (PKW): 6 years
- Vehicles (Motorcycle): 7 years

Pro-rata first year: Purchase month ${purchaseMonth} = ${monthsOwned}/12 months

## STEP 3: TAX DEDUCTIBILITY

**IMPORTANT: Research information is provided above if available.**

General rules:
- 100% business expenses: Fully deductible (Berufshaftpflicht, office equipment)
- Mixed use: Partially deductible (car insurance, home office)
- Private: 0% deductible (private health/life insurance)

# TASK - Follow these steps in order:
1. **Suggest the correct expense category** based on description (see list below)
2. **Determine depreciation method:**
   - If operating expense (insurance, rent, etc.): recommendation = "immediate"
   - If asset < 800€: recommendation = "immediate"
   - If asset ≥ 800€: recommendation = "partial", find useful life from AfA tables
3. **Calculate first-year deduction** (pro-rata: ${monthsOwned} von 12 Monaten)
4. **Determine tax deductibility percentage** (0-100% based on business vs. private use)
5. **Provide reasoning** with § references

# AVAILABLE EXPENSE CATEGORIES:
Choose the most appropriate category for this expense:

**IT & Digital Equipment (1 year AfA):**
- "computer" = Computer, Laptop, Tablet, Workstation, Server
- "software" = Software, Licenses, SaaS subscriptions
- "peripherals" = Keyboard, Mouse, Headset, Webcam, Docking Station
- "storage" = External HDD, USB drives, NAS
- "display" = Monitors, Displays, Projectors
- "printer" = Printers, Scanners, Multifunction devices

**Office Equipment:**
- "office_furniture" = Desks, Chairs, Shelves (13 years)
- "office_equipment" = Phones, Copiers (5-7 years)
- "office_supplies" = Consumables, stationery (immediate)

**Vehicles:**
- "vehicle_car" = Cars, passenger vehicles (6 years)
- "vehicle_motorcycle" = Motorcycles, E-bikes (7 years)

**Professional Tools:**
- "camera" = Photography equipment (7 years)
- "tools" = Hand tools, equipment (5 years)
- "machinery" = Larger machinery (varies)

**Services & Operating Expenses:**
- "insurance" = Business insurance (Berufshaftpflicht, KFZ-Versicherung, etc.)
- "professional_services" = Accountant, lawyer, consultants
- "marketing" = Marketing, advertising, website
- "utilities" = Electricity, water, heating, gas
- "travel" = Business travel, hotels, transportation
- "meals" = Business meals (often 70% deductible)
- "training" = Courses, workshops, professional development
- "rent" = Office/business space rent
- "telecommunications" = Phone, internet, mobile contracts

**Other:**
- "other" = Anything that doesn't fit above categories

# FORMAT (JSON only, no markdown, no tool_call tags):
{
  "recommendation": "immediate" | "partial",
  "reasoning": "DEPRECIATION: Brief explanation based on research",
  "suggested_years": 0,
  "suggested_category": "computer",
  "category_reasoning": "Brief explanation why this category fits",
  "tax_deductible_percentage": 100,
  "tax_deductibility_reasoning": "TAX DEDUCTIBILITY: Explanation based on research",
  "confidence": 0.90,
  "sources": [
    {
      "title": "Source title from VERIFIED SOURCES",
      "url": "https://example.com/url-from-verified-sources"
    }
  ]
}

**CRITICAL: For "suggested_category", use ONLY the category CODE in quotes from the list above!**
Examples of CORRECT category values:
- "computer" (NOT "Computer" or "IT & Digital Equipment")
- "insurance" (NOT "Business insurance")
- "professional_services" (NOT "Professional Services")
- "office_furniture" (NOT "Office Equipment - Furniture")

**IMPORTANT: The "sources" array MUST include URLs from the VERIFIED SOURCES section above!**
Copy the title and url from each source listed in the VERIFIED SOURCES section.

## ANALYSIS GUIDELINES:

**CRITICAL: You MUST provide sources for your recommendations**
- The "sources" field is MANDATORY - you MUST include it in your JSON response
- Copy sources from the VERIFIED SOURCES section above into your "sources" array
- Each source must have "title" and "url" fields
- Include AT LEAST 2-3 sources from the VERIFIED SOURCES list
- Format: "sources": [{"title": "...", "url": "..."}, {"title": "...", "url": "..."}]

**When analyzing expenses:**
1. Review the WEB SEARCH RESULTS and VERIFIED SOURCES sections above
2. Use the ACTUAL expense description and category to determine the correct classification
3. Identify if it's an operating expense or depreciable asset based on the research
4. For assets: Find useful life from AfA tables in the web search results
5. For services/consumables: These are operating expenses (immediate deduction)
6. Determine tax_deductible_percentage based on typical business use from research
7. **MANDATORY**: Copy URLs from VERIFIED SOURCES into your "sources" array

**Category Suggestion Guidelines:**
- Analyze the ACTUAL expense description carefully
- Match to the most appropriate category from the list above
- Don't assume categories based on examples - use the real data
- Provide clear reasoning for your category choice

**Tax Deductibility:**
- Operating expenses (services, consumables, rent, etc.): Usually 100% deductible
- Insurance: Depends on business vs. private use ratio
- Vehicles/equipment: Based on business use percentage
- Private expenses: 0% deductible
- Include source URL from VERIFIED SOURCES explaining deductibility rules

**Respond with valid JSON ONLY. Do NOT use <tool_call> tags in your final response.**
**MANDATORY: Include the "sources" array with URLs from VERIFIED SOURCES section above.**
**The sources field is REQUIRED - your response will be rejected without it!**

Respond ONLY with JSON. No markdown, no explanations.
  "tax_deductible_percentage": 100,
  "tax_deductibility_reasoning": "TAX DEDUCTIBILITY: Vollständig abzugsfähig als betriebliche Ausgabe (100% Betriebsnutzung).",
  "confidence": 0.95
}

# ANALYSIS GUIDELINES:

## STEP 1: DEPRECIATION (AfA) Analysis
Determine HOW to write off the expense over time:
- If < 800€: recommendation = "immediate" (Sofortabschreibung)
- If >= 800€: recommendation = "partial", suggested_years = AfA useful life
- Calculate first-year pro-rata: ${monthsOwned}/12 months

## STEP 2: TAX DEDUCTIBILITY Analysis
Determine WHAT PERCENTAGE is tax-deductible (INDEPENDENT from depreciation!):

### 100% Deductible (Full Business Expenses):
- Business insurance (Berufshaftpflicht, Betriebshaftpflicht)
- Professional services (Steuerberater, Anwalt, Consultants)
- Office equipment and supplies (100% business use)
- Business software and subscriptions
- Business travel
- Vehicle expenses if 100% business use

### PARTIALLY Deductible (Mixed Business/Private Use):
**IMPORTANT: Base percentage on actual business vs. private usage ratio!**

Examples:
- Vehicle insurance: If car used 30% for business → 30% tax-deductible
- Home office costs: If 15% of home used for office → 15% deductible  
- Phone/internet: If 60% business use → 60% deductible
- Vehicle insurance: If driving 12,000 business km out of 20,000 total km → 60% deductible

For these expenses:
1. Estimate business use percentage from description
2. Set tax_deductible_percentage accordingly (0-100)
3. Explain reasoning: "Geschätzter Geschäftsanteil: X%, basierend auf [reason]"

### 0% Deductible (Private/Personal):
- Private health insurance (Krankenversicherung) - personal coverage
- Personal liability insurance (Privathaftpflicht)
- Life insurance (Lebensversicherung)
- Private travel, meals, entertainment

**For insurance expenses:** ALWAYS analyze business vs. private use ratio!
- Berufshaftpflicht (professional liability): 100% deductible
- KFZ-Versicherung (car insurance): Depends on business use percentage (e.g., 30% business → 30% deductible)
- Private health/life insurance: 0% deductible (unless special business conditions)

⚠️ If unsure about deductibility (confidence < 85%), you SHOULD search online for: "steuerlich absetzbar ${expense.description}"

**Set both fields:**
- "tax_deductible_percentage" (0-100): The percentage that can be declared
- "tax_deductibility_reasoning": Start with "TAX DEDUCTIBILITY:" and explain the percentage

CRITICAL: Your response will be parsed by JSON.parse(). It MUST be valid JSON with:
- All strings in double quotes (not single quotes)
- All property names in double quotes
- Commas between all properties (no trailing commas)
- Proper escaping of special characters in strings
- No comments, no extra text

Respond with ONLY valid JSON - nothing before the opening {, nothing after the closing }.`;
  }

  private parseAIResponse(aiContent: string, expense: ExpenseForAnalysis): DepreciationAnalysis {
    try {
      // Log the FULL AI response for debugging
      logger.info(`[AI Response] ===== FULL RESPONSE START =====`);
      logger.info(aiContent);
      logger.info(`[AI Response] ===== FULL RESPONSE END =====`);
      
      // Try to extract JSON from markdown code blocks or plain JSON
      const jsonMatch = aiContent.match(/```json\s*([\s\S]*?)\s*```/) || 
                        aiContent.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        logger.warn('No JSON found in AI response:', aiContent.substring(0, 200));
        throw new Error('No JSON in response');
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      logger.debug('Parsing JSON:', jsonStr.substring(0, 200));
      
      // Clean up common JSON issues
      const cleanedJson = jsonStr
        .replace(/\n/g, ' ')  // Remove newlines within strings
        .replace(/\r/g, '')    // Remove carriage returns
        .replace(/\t/g, ' ')   // Replace tabs with spaces
        .trim();
      
      const parsed = JSON.parse(cleanedJson);
      
      // Log sources immediately after parsing
      logger.info(`[AI Response] ===== SOURCES CHECK =====`);
      logger.info(`[AI Response] Sources field exists: ${Object.prototype.hasOwnProperty.call(parsed, 'sources')}`);
      logger.info(`[AI Response] Sources value: ${JSON.stringify(parsed.sources)}`);
      logger.info(`[AI Response] Sources count: ${parsed.sources?.length || 0}`);

      const recommendation = this.validateRecommendation(parsed.recommendation, expense.net_amount);
      const taxDeductible = this.calculateTaxDeductibleAmount(
        expense.net_amount,
        recommendation,
        parsed.suggested_years,
        expense.expense_date
      );

      // For immediate deduction, suggested_years should be null
      const suggestedYears = recommendation === 'immediate' 
        ? null 
        : (parsed.suggested_years || this.getDefaultYears(parsed.useful_life_category));

      return {
        recommendation,
        reasoning: parsed.reasoning || 'AI analysis completed',
        suggested_years: suggestedYears,
        useful_life_category: parsed.useful_life_category,
        suggested_category: parsed.suggested_category || expense.category, // Default to current category
        category_reasoning: parsed.category_reasoning || 'Category kept as entered',
        tax_deductible_amount: taxDeductible,
        tax_deductible_percentage: parsed.tax_deductible_percentage || 100, // Default: fully deductible
        tax_deductibility_reasoning: parsed.tax_deductibility_reasoning || 'Vollständig abzugsfähig als betriebliche Ausgabe.',
        references: parsed.references || this.getReferences(recommendation),
        sources: parsed.sources || [], // Web sources used for verification
        confidence: Math.min(Math.max(parsed.confidence || 0.8, 0), 1),
        gwg_applicable: expense.net_amount < 1000,
        requires_depreciation: expense.net_amount > 1000,
      };
    } catch (error: any) {
      logger.error('[AI Response] Parse failed:', error.message);
      logger.error('[AI Response] Failed to parse this content:', aiContent.substring(0, 500));
      // Don't fallback here - throw error so analyzeExpense can retry
      throw new Error(`JSON parse failed: ${error.message}`);
    }
  }

  private validateRecommendation(rec: string, netAmount: number): 'none' | 'immediate' | 'partial' {
    // Trust the AI's recommendation - it has context we don't have
    // The AI knows whether something is an asset (requires depreciation) or 
    // an operating expense (immediate deduction regardless of amount)
    if (['none', 'immediate', 'partial'].includes(rec)) {
      return rec as 'none' | 'immediate' | 'partial';
    }
    
    // Fallback only if AI returns invalid recommendation
    if (netAmount > 1000) return 'partial';
    if (netAmount >= 250) return 'immediate';
    return 'none';
  }

  private calculateTaxDeductibleAmount(
    netAmount: number,
    recommendation: string,
    years?: number,
    purchaseDate?: string
  ): number {
    if (recommendation === 'immediate') return netAmount;
    if (recommendation === 'partial' && years) {
      // For 1-year depreciation, always return full amount (no pro-rata)
      // Since 2021, IT equipment has 1-year useful life and is fully deductible in year of purchase
      if (years === 1) {
        return netAmount;
      }
      
      // For multi-year depreciation, calculate pro-rata for first year
      const annual = netAmount / years;
      if (purchaseDate) {
        const month = new Date(purchaseDate).getMonth() + 1;
        const monthsOwned = 13 - month; // Months remaining in year including purchase month
        return (annual * monthsOwned) / 12;
      }
      return annual;
    }
    return 0;
  }

  private getDefaultYears(category?: string): number {
    if (!category) return 5;
    const key = category.toLowerCase().replace(/[^a-z]/g, '_');
    return AfA_TABLE[key] || 5;
  }

  /**
   * Research uncommon assets using DuckDuckGo MCP server
   * Searches for official BMF AfA tables and useful life information
   * 
   * Note: This method is designed to work with the DuckDuckGo MCP server
   * running via Docker MCP toolkit. The actual MCP tool call should be made
   * by the AI agent/client with access to mcp_duckduckgo_search tool.
   * 
   * For direct backend usage, this returns null and logs a warning.
   * The AI analysis prompt will include instructions for the AI to perform
   * the search when needed.
   */
  private async researchAssetUsefulLife(description: string): Promise<number | null> {
    try {
      const searchQuery = `AfA Tabelle ${description} Nutzungsdauer BMF`;
      logger.info(`Asset research recommended for: ${searchQuery}`);
      logger.info('Note: DuckDuckGo MCP search should be performed by AI agent with mcp_duckduckgo_search access');
      
      // Backend cannot directly call MCP tools - this is handled by the AI agent
      // Return null to indicate research should be done by the AI layer
      return null;
    } catch (error: any) {
      logger.warn(`Asset research preparation failed: ${error.message}`);
      return null;
    }
  }

  private getReferences(recommendation: string): string[] {
    if (recommendation === 'immediate') return ['§ 6 Abs. 2 EStG'];
    if (recommendation === 'partial') return ['§ 7 Abs. 1 EStG', 'BMF AfA-Tabellen'];
    return [];
  }

  private basicDepreciationRules(expense: ExpenseForAnalysis): DepreciationAnalysis {
    const netAmount = expense.net_amount;

    if (netAmount < 250) {
      return {
        recommendation: 'immediate',
        reasoning: 'Unter 250€. Sofortabzug empfohlen.',
        suggested_category: expense.category, // Keep current category
        category_reasoning: 'Category kept as entered (fallback mode)',
        tax_deductible_amount: netAmount,
        tax_deductible_percentage: 100,
        tax_deductibility_reasoning: 'Vollständig abzugsfähig als betriebliche Ausgabe.',
        confidence: 0.9,
        references: ['§ 6 Abs. 2 EStG'],
        gwg_applicable: true,
        requires_depreciation: false,
      };
    }

    if (netAmount >= 250 && netAmount <= 800) {
      return {
        recommendation: 'immediate',
        reasoning: 'GWG 250-800€. Sofortabzug nach § 6 Abs. 2 EStG.',
        suggested_category: expense.category,
        category_reasoning: 'Category kept as entered (fallback mode)',
        tax_deductible_amount: netAmount,
        tax_deductible_percentage: 100,
        tax_deductibility_reasoning: 'Vollständig abzugsfähig als betriebliche Ausgabe.',
        confidence: 0.95,
        references: ['§ 6 Abs. 2 EStG'],
        gwg_applicable: true,
        requires_depreciation: false,
      };
    }

    if (netAmount > 800 && netAmount <= 1000) {
      return {
        recommendation: 'immediate',
        reasoning: '800-1000€. Wahlrecht. Sofortabzug empfohlen.',
        suggested_category: expense.category,
        category_reasoning: 'Category kept as entered (fallback mode)',
        tax_deductible_amount: netAmount,
        tax_deductible_percentage: 100,
        tax_deductibility_reasoning: 'Vollständig abzugsfähig als betriebliche Ausgabe.',
        confidence: 0.85,
        references: ['§ 6 Abs. 2 EStG'],
        gwg_applicable: true,
        requires_depreciation: false,
      };
    }

    // Default: Depreciation required over 5 years (fallback if asset type unknown)
    // Note: Computer/IT would be 1 year, but we fall back to 5 for unknown assets
    const years = 5;
    const month = new Date(expense.expense_date).getMonth() + 1;
    const monthsOwned = 13 - month;
    const annual = netAmount / years;
    const firstYear = (annual * monthsOwned) / 12;

    return {
      recommendation: 'partial',
      reasoning: `Über 1000€. Abschreibungspflichtig. ${years} Jahre, ${monthsOwned} Monate im ersten Jahr.`,
      suggested_years: years,
      useful_life_category: 'other', // Unknown asset type
      suggested_category: expense.category,
      category_reasoning: 'Category kept as entered (fallback mode)',
      tax_deductible_amount: firstYear,
      tax_deductible_percentage: 100,
      tax_deductibility_reasoning: 'Vollständig abzugsfähig als betriebliche Ausgabe.',
      confidence: 0.6,
      references: ['§ 7 Abs. 1 EStG'],
      gwg_applicable: false,
      requires_depreciation: true,
    };
  }
}
