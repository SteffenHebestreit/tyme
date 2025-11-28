/**
 * @fileoverview Settings Service
 * API client for user settings and company information management
 */

import apiClient from './client';
import { Settings } from '../types';

/**
 * Get current user's settings
 * Also syncs user_region to localStorage for use by chart components
 */
export const getSettings = async (): Promise<Settings> => {
  const response = await apiClient.get<Settings>('/settings');
  const settings = response.data;
  
  // Sync user_region to localStorage for chart holiday coloring
  if (settings.user_region) {
    localStorage.setItem('user_region', settings.user_region);
  }
  
  return settings;
};

/**
 * Update current user's settings
 */
export const updateSettings = async (settings: Partial<Settings>): Promise<Settings> => {
  const response = await apiClient.put<Settings>('/settings', settings);
  return response.data;
};
