/**
 * @fileoverview MCP (Model Context Protocol) Client Service
 * 
 * Handles communication with the FastAPI MCP server for PDF text extraction.
 * Supports the file_to_markdown tool for converting PDFs to structured markdown.
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../../utils/logger';
import FormData from 'form-data';

/**
 * MCP Client Service for interacting with FastAPI MCP Template Server
 */
export class MCPClientService {
  private client: AxiosInstance;
  private serverUrl: string;

  constructor(serverUrl?: string) {
    this.serverUrl = serverUrl || process.env.MCP_SERVER_URL || 'http://mcp-server:8000';
    
    this.client = axios.create({
      baseURL: this.serverUrl,
      timeout: 60000, // 60 seconds for PDF processing
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info(`MCP Client initialized with server: ${this.serverUrl}`);
  }

  /**
   * Check if MCP server is healthy and available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/api/health');
      return response.status === 200;
    } catch (error) {
      logger.error('MCP server health check failed:', error);
      return false;
    }
  }

  /**
   * Extract text from a receipt file using the MCP server.
   *
   * The file_to_markdown tool converts PDFs and images alike: for an image it
   * runs markitdown's LLM description path (FTMD_MARKITDOWN_ENABLE_LLM), which
   * reads a photographed or scanned receipt well enough for the downstream
   * extraction prompt. The MCP server picks the converter from the filename
   * extension, so the real filename has to be passed through.
   *
   * @param fileBuffer - Receipt file buffer (PDF or image)
   * @param filename - Original filename, extension included
   * @returns Extracted text in markdown format
   */
  async extractDocumentText(fileBuffer: Buffer, filename: string): Promise<string> {
    try {
      // Convert buffer to base64
      const base64Content = fileBuffer.toString('base64');

      logger.info(`Extracting text from ${filename} (${fileBuffer.length} bytes)`);

      // Create form data with params as JSON string (as expected by MCP server)
      const formData = new FormData();
      const params = {
        filename,
        base64_content: base64Content,
      };
      formData.append('params', JSON.stringify(params));

      // Call MCP server file_to_markdown tool with form data
      const response = await this.client.post(
        '/api/tools/file_to_markdown',
        formData,
        {
          headers: {
            ...formData.getHeaders(),
          },
        }
      );

      // Handle nested response structure
      if (response.data.success && response.data.result) {
        const result = response.data.result;
        
        if (typeof result === 'string') {
          // Direct string result
          logger.info(`Successfully extracted ${result.length} characters from ${filename}`);
          return result;
        } else if (result.markdown || result.content) {
          // Structured result with markdown field
          const extractedText = result.markdown || result.content;
          logger.info(`Successfully extracted ${extractedText.length} characters from ${filename}`);
          return extractedText;
        } else if (result.success === false) {
          // Nested error
          throw new Error(result.error || 'Unknown error during PDF extraction');
        }
      }
      
      throw new Error(response.data.error || 'Unknown error during PDF extraction');
    } catch (error: any) {
      logger.error(`Failed to extract text from ${filename}:`, error.message);
      throw new Error(`Text extraction failed: ${error.message}`);
    }
  }

  /**
   * Extract text with enhanced LLM-powered OCR (for scanned documents)
   * 
   * @param fileBuffer - PDF file buffer
   * @param filename - Original filename
   * @returns Extracted text with enhanced OCR
   */
  async extractPDFTextWithOCR(fileBuffer: Buffer, filename: string): Promise<string> {
    try {
      const base64Content = fileBuffer.toString('base64');

      logger.info(`Extracting text from PDF with OCR: ${filename}`);

      const response = await this.client.post('/api/tools/file_to_markdown', {
        filename,
        base64_content: base64Content,
        use_llm: true, // Enable LLM for enhanced OCR on scanned documents
      });

      if (response.data.success) {
        const extractedText = response.data.result;
        logger.info(`Successfully extracted ${extractedText.length} characters (with OCR) from ${filename}`);
        return extractedText;
      } else {
        throw new Error(response.data.error || 'Unknown error during PDF OCR extraction');
      }
    } catch (error: any) {
      logger.error(`Failed to extract text with OCR from PDF ${filename}:`, error.message);
      throw new Error(`PDF OCR extraction failed: ${error.message}`);
    }
  }

  /**
   * List available tools from MCP server
   */
  async listTools(): Promise<any[]> {
    try {
      const response = await this.client.get('/tools');
      return response.data.tools || [];
    } catch (error) {
      logger.error('Failed to list MCP tools:', error);
      return [];
    }
  }
}

// Export singleton instance
export const mcpClientService = new MCPClientService();
