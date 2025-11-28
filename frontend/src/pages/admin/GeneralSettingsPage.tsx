/**
 * @fileoverview General settings page for application-wide configuration.
 * 
 * Provides interface for:
 * - Default currency selection
 * - Company information (name, address, contact details)
 * - Tax identification
 * - Company logo
 * - Invoice settings
 * 
 * @module pages/admin/GeneralSettingsPage
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CURRENCIES } from '@/constants/currencies';
import { CustomSelect } from '@/components/forms/CustomSelect';
import { getSettings, updateSettings } from '@/api/services/settings.service';
import { Settings } from '@/api/types';
import { GERMAN_STATES } from '@/utils/holidays-api';

/**
 * General settings page component.
 * 
 * Features:
 * - Default currency configuration
 * - Company information management
 * - Tax identification
 * - Contact details
 * - Company logo upload
 * - Invoice settings
 * - Persistent storage via API
 * - Dark mode support
 * 
 * @component
 * @example
 * <GeneralSettingsPage />
 * 
 * @returns {JSX.Element} General settings configuration interface
 */
export default function GeneralSettingsPage() {
  const { t } = useTranslation('settings');
  
  // Form state
  const [settings, setSettings] = useState<Partial<Settings>>({
    default_currency: 'EUR',
    user_region: '',
    company_name: '',
    company_subline: '',
    company_address: '',
    company_email: '',
    company_phone: '',
    company_website: '',
    company_tax_id: '',
    company_logo_url: '',
    ai_enabled: false,
    ai_provider: 'lm_studio',
    ai_api_url: 'http://localhost:1234/v1',
    ai_api_key: '',
    ai_model: 'llama-3.2-3b-instruct',
    mcp_server_url: 'http://localhost:8000',
    mcp_server_api_key: '',
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string>('');

  // Load settings from API on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const data = await getSettings();
        setSettings(data);
        // Sync user_region to localStorage for use in charts
        if (data.user_region) {
          localStorage.setItem('user_region', data.user_region);
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
        setSaveMessage(t('admin.general.loadError') || 'Failed to load settings');
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, [t]);

  // Save settings to API
  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage('');

    try {
      const updatedSettings = await updateSettings(settings);
      setSettings(updatedSettings);
      setSaveMessage(t('admin.general.saveSuccess'));
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSaveMessage('');
      }, 3000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveMessage(t('admin.general.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  // Update form field
  const handleFieldChange = (field: keyof Settings, value: any) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const currencyOptions = CURRENCIES.map((currency) => ({
    value: currency.code,
    label: `${currency.symbol} ${currency.name} (${currency.code})`,
  }));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-600 dark:text-gray-400">
          {t('common.loading') || 'Loading...'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
          {t('admin.general.title')}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('admin.general.subtitle')}
        </p>
      </div>

      {/* Company Information */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
          Company Information
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Company Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Company Name
            </label>
            <input
              type="text"
              value={settings.company_name || ''}
              onChange={(e) => handleFieldChange('company_name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="Your Company Ltd."
            />
          </div>

          {/* Company Subline */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Company Tagline
            </label>
            <input
              type="text"
              value={settings.company_subline || ''}
              onChange={(e) => handleFieldChange('company_subline', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="Professional Services"
            />
          </div>

          {/* Company Address */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Address
            </label>
            <textarea
              value={settings.company_address || ''}
              onChange={(e) => handleFieldChange('company_address', e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="123 Main Street&#10;12345 City, Country"
            />
          </div>
        </div>
      </div>

      {/* Tax & Contact Information */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
          Tax & Contact Information
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Tax ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Tax ID (USt-IdNr)
            </label>
            <input
              type="text"
              value={settings.company_tax_id || ''}
              onChange={(e) => handleFieldChange('company_tax_id', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="DE123456789"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Email
            </label>
            <input
              type="email"
              value={settings.company_email || ''}
              onChange={(e) => handleFieldChange('company_email', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="info@company.com"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Phone
            </label>
            <input
              type="tel"
              value={settings.company_phone || ''}
              onChange={(e) => handleFieldChange('company_phone', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="+49 123 456789"
            />
          </div>

          {/* Website */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Website
            </label>
            <input
              type="url"
              value={settings.company_website || ''}
              onChange={(e) => handleFieldChange('company_website', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="https://www.company.com"
            />
          </div>
        </div>
      </div>

      {/* Company Logo */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
          Company Logo
        </h3>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Logo URL
          </label>
          <input
            type="url"
            value={settings.company_logo_url || ''}
            onChange={(e) => handleFieldChange('company_logo_url', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            placeholder="https://example.com/logo.png"
          />
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Enter the URL of your company logo. It will appear on invoices and documents.
          </p>
          {settings.company_logo_url && (
            <div className="mt-3 p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Preview:</p>
              <img 
                src={settings.company_logo_url} 
                alt="Company Logo" 
                className="max-h-24 object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* User Location Settings */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
          User Location
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Set your location for timezone handling and regional holiday display.
        </p>
        
        <div className="grid grid-cols-1 gap-4 max-w-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Region (German State)
            </label>
            <select
              value={settings.user_region || ''}
              onChange={(e) => {
                handleFieldChange('user_region', e.target.value);
                // Also save to localStorage for immediate use
                if (e.target.value) {
                  localStorage.setItem('user_region', e.target.value);
                } else {
                  localStorage.removeItem('user_region');
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="">No specific region</option>
              {GERMAN_STATES.map((state) => (
                <option key={state.code} value={state.code}>
                  {state.name}
                </option>
              ))}
            </select>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Your region is used to display regional holidays in charts and determine timezone for time tracking.
            </p>
          </div>
        </div>
      </div>

      {/* Currency Settings */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
          {t('admin.general.currencySettings')}
        </h3>
        
        <div className="grid grid-cols-1 gap-4 max-w-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('admin.general.defaultCurrency')}
            </label>
            <CustomSelect
              value={settings.default_currency || 'EUR'}
              onChange={(value: string) => handleFieldChange('default_currency', value)}
              options={currencyOptions}
              placeholder={t('admin.general.currencyPlaceholder')}
              size="md"
            />
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {t('admin.general.currencyDescription')}
            </p>
          </div>
        </div>
      </div>

      {/* AI Integration Settings */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            {t('admin.ai.title')}
          </h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('admin.ai.subtitle')}
          </p>
        </div>

        {/* Enable AI Toggle */}
        <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
          <input
            type="checkbox"
            id="ai-enabled"
            checked={settings.ai_enabled || false}
            onChange={(e) => handleFieldChange('ai_enabled', e.target.checked)}
            className="w-5 h-5 text-purple-600 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-purple-500"
          />
          <label htmlFor="ai-enabled" className="flex-1 cursor-pointer">
            <div className="text-sm font-medium text-gray-900 dark:text-white">
              {t('admin.ai.enableAI')}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
              {t('admin.ai.enableAIDescription')}
            </div>
          </label>
        </div>

        {/* AI Configuration (shown only when enabled) */}
        {settings.ai_enabled && (
          <div className="space-y-4 pl-4 border-l-2 border-purple-500">
            {/* AI Provider */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('admin.ai.provider')}
              </label>
              <select
                value={settings.ai_provider || 'lm_studio'}
                onChange={(e) => handleFieldChange('ai_provider', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="lm_studio">LM Studio</option>
                <option value="openai">OpenAI</option>
                <option value="ollama">Ollama</option>
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('admin.ai.providerDescription')}
              </p>
            </div>

            {/* LM Studio API URL */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('admin.ai.apiUrl')}
              </label>
              <input
                type="url"
                value={settings.ai_api_url || ''}
                onChange={(e) => handleFieldChange('ai_api_url', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
                placeholder="http://localhost:1234/v1"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('admin.ai.apiUrlDescription')}
              </p>
            </div>

            {/* API Key (Optional) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('admin.ai.apiKey')}
                <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('admin.ai.optional')}
                </span>
              </label>
              <input
                type="password"
                value={settings.ai_api_key || ''}
                onChange={(e) => handleFieldChange('ai_api_key', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
                placeholder="sk-..."
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('admin.ai.apiKeyDescription')}
              </p>
            </div>

            {/* Model Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('admin.ai.model')}
              </label>
              <input
                type="text"
                value={settings.ai_model || ''}
                onChange={(e) => handleFieldChange('ai_model', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
                placeholder="llama-3.2-3b-instruct"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('admin.ai.modelDescription')}
              </p>
            </div>

            {/* MCP Server URL */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('admin.ai.mcpServerUrl')}
              </label>
              <input
                type="url"
                value={settings.mcp_server_url || ''}
                onChange={(e) => handleFieldChange('mcp_server_url', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
                placeholder="http://localhost:8000"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('admin.ai.mcpServerUrlDescription')}
              </p>
            </div>

            {/* MCP Server API Key (Optional) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('admin.ai.mcpServerApiKey')}
                <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('admin.ai.optional')}
                </span>
              </label>
              <input
                type="password"
                value={settings.mcp_server_api_key || ''}
                onChange={(e) => handleFieldChange('mcp_server_api_key', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
                placeholder="mcp-key-..."
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('admin.ai.mcpServerApiKeyDescription')}
              </p>
            </div>

            {/* Info Box */}
            <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-900/30 dark:bg-purple-900/20">
              <div className="flex items-start gap-3">
                <span className="text-xl">🤖</span>
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-purple-900 dark:text-purple-100 mb-1">
                    {t('admin.ai.infoTitle')}
                  </h4>
                  <p className="text-sm text-purple-700 dark:text-purple-300">
                    {t('admin.ai.infoDescription')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white rounded-lg font-medium transition-colors"
        >
          {isSaving ? t('admin.general.saving') : t('admin.general.saveButton')}
        </button>
        
        {saveMessage && (
          <p
            className={`text-sm font-medium ${
              saveMessage.includes('success') || saveMessage.includes('erfolgreich') || saveMessage.includes('Success')
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {saveMessage}
          </p>
        )}
      </div>

      {/* Information Box */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/30 dark:bg-blue-900/20">
        <div className="flex items-start gap-3">
          <span className="text-xl">ℹ️</span>
          <div className="flex-1">
            <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">
              About Settings
            </h4>
            <p className="text-sm text-blue-700 dark:text-blue-300">
              Your company information will appear on all generated invoices and documents. Make sure to keep this information up to date.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
