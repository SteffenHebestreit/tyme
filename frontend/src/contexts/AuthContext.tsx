import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { keycloak, TOKEN_REFRESH_THRESHOLD, TOKEN_CHECK_INTERVAL } from '../config/keycloak.config';
import { setTokens, clearTokens, getUserFromToken } from '../services/auth/tokenManager';
import { useApp } from '../store/AppContext';
import { getSettings } from '../api/services/settings.service';

// Define user interface
interface User {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  roles: string[];
}

// Define the auth context type
interface AuthContextType {
  user: User | null;
  token: string | null;
  login: () => void;
  logout: () => void;
  isLoadingAuth: boolean;
  isAuthenticated: boolean;
  hasRole: (role: string) => boolean;
  isAdmin: boolean;
}

// Create the auth context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Module-level flag to prevent multiple Keycloak initializations
// This survives React StrictMode double-mount in development
let keycloakInitPromise: Promise<boolean> | null = null;

// Custom hook for using the auth context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Props interface for the AuthProvider component
interface AuthProviderProps {
  children: ReactNode;
}

// Create the AuthProvider component
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isKeycloakInitialized, setIsKeycloakInitialized] = useState(false);
  const { dispatch: appDispatch } = useApp();

  /**
   * Initialize Keycloak on component mount
   * 
   * This runs once when the app starts and:
   * 1. Initializes the Keycloak JS adapter
   * 2. Checks for existing authentication (SSO)
   * 3. Stores tokens if authenticated
   * 4. Sets up user state
   */
  useEffect(() => {
    const initKeycloak = async () => {
      try {
        // Use promise-based singleton to prevent double initialization
        // This handles React StrictMode's double-mount in development
        if (!keycloakInitPromise) {
          console.log('[Auth] Initializing Keycloak...');
          
          keycloakInitPromise = keycloak.init({
            onLoad: 'check-sso',
            checkLoginIframe: false, // Disable iframe check to avoid X-Frame-Options issues
            pkceMethod: 'S256',
            enableLogging: import.meta.env.DEV,
          });
        } else {
          console.log('[Auth] Using existing Keycloak initialization...');
        }

        const authenticated = await keycloakInitPromise;
        setIsKeycloakInitialized(true);

        if (authenticated) {
          console.log('[Auth] ✅ User is authenticated');
          
          // Store tokens in localStorage
          if (keycloak.token && keycloak.refreshToken) {
            setTokens(keycloak.token, keycloak.refreshToken, keycloak.idToken);
            setToken(keycloak.token);
          }

          // Get user info from token
          const userInfo = getUserFromToken();
          if (userInfo) {
            setUser(userInfo);
            
            // Update AppContext
            appDispatch({
              type: 'LOGIN_SUCCESS',
              payload: {
                id: userInfo.id,
                email: userInfo.email,
                username: userInfo.username,
                role: userInfo.roles.includes('admin') ? 'admin' : 'user',
              },
            });
          }
          
          // Load settings to sync user_region to localStorage (for holiday coloring in charts)
          try {
            await getSettings();
          } catch (e) {
            console.warn('[Auth] Failed to load settings:', e);
          }
        } else {
          console.log('[Auth] ℹ️ User is not authenticated');
        }
      } catch (error) {
        console.error('[Auth] ❌ Keycloak initialization failed:', error);
        // Reset the promise so it can be retried
        keycloakInitPromise = null;
      } finally {
        setIsLoadingAuth(false);
      }
    };

    initKeycloak();
  }, [appDispatch]);

  /**
   * Proactive token refresh mechanism
   * 
   * Checks token expiration every 5 seconds (TOKEN_CHECK_INTERVAL).
   * If token expires within 30 seconds (TOKEN_REFRESH_THRESHOLD),
   * automatically refreshes it using Keycloak's updateToken() method.
   */
  useEffect(() => {
    if (!isKeycloakInitialized || !keycloak.authenticated) {
      return;
    }

    const refreshTokenProactively = async () => {
      try {
        // updateToken(minValidity) refreshes if token expires within minValidity seconds
        const refreshed = await keycloak.updateToken(TOKEN_REFRESH_THRESHOLD);
        
        if (refreshed && keycloak.token && keycloak.refreshToken) {
          console.log('[Auth] ✅ Token refreshed proactively');
          
          // Update tokens in localStorage
          setTokens(keycloak.token, keycloak.refreshToken, keycloak.idToken);
          setToken(keycloak.token);
          
          // Update user info (roles might have changed)
          const userInfo = getUserFromToken();
          if (userInfo) {
            setUser(userInfo);
          }
        }
      } catch (error) {
        console.error('[Auth] ❌ Token refresh failed:', error);
        
        // If refresh fails, log out the user
        logout();
      }
    };

    // Set up interval to check every 5 seconds
    const intervalId = setInterval(refreshTokenProactively, TOKEN_CHECK_INTERVAL);

    console.log('[Auth] ✅ Token refresh interval started (checking every 5 seconds)');

    return () => {
      clearInterval(intervalId);
      console.log('[Auth] Token refresh interval stopped');
    };
  }, [isKeycloakInitialized]);

  /**
   * Listen to Keycloak events
   * 
   * Keycloak emits events for authentication state changes.
   * We listen to these events to keep our state in sync.
   */
  useEffect(() => {
    if (!isKeycloakInitialized) {
      return;
    }

    // Token expired event
    keycloak.onTokenExpired = () => {
      console.warn('[Auth] ⚠️ Token expired, refreshing...');
      keycloak.updateToken(TOKEN_REFRESH_THRESHOLD).catch((error) => {
        console.error('[Auth] ❌ Failed to refresh expired token:', error);
        logout();
      });
    };

    // Authentication success event
    keycloak.onAuthSuccess = () => {
      console.log('[Auth] ✅ Authentication successful');
      
      if (keycloak.token && keycloak.refreshToken) {
        setTokens(keycloak.token, keycloak.refreshToken, keycloak.idToken);
        setToken(keycloak.token);
        
        const userInfo = getUserFromToken();
        if (userInfo) {
          setUser(userInfo);
          
          appDispatch({
            type: 'LOGIN_SUCCESS',
            payload: {
              id: userInfo.id,
              email: userInfo.email,
              username: userInfo.username,
              role: userInfo.roles.includes('admin') ? 'admin' : 'user',
            },
          });
        }
      }
    };

    // Authentication error event
    keycloak.onAuthError = (error) => {
      console.error('[Auth] ❌ Authentication error:', error);
      clearTokens();
      setToken(null);
      setUser(null);
    };

    // Logout event
    keycloak.onAuthLogout = () => {
      console.log('[Auth] ℹ️ User logged out');
      clearTokens();
      setToken(null);
      setUser(null);
      appDispatch({ type: 'LOGOUT' });
    };
  }, [isKeycloakInitialized, appDispatch]);

  /**
   * Login function
   * 
   * Redirects user to Keycloak login page.
   * After successful login, user is redirected back to the application.
   */
  const login = useCallback(() => {
    keycloak.login({
      redirectUri: window.location.origin + window.location.pathname,
    });
  }, []);

  /**
   * Logout function
   * 
   * Logs out user from Keycloak and clears local state.
   * User is redirected to Keycloak logout page, then back to login.
   */
  const logout = useCallback(() => {
    console.log('[Auth] Logging out...');
    
    // Clear local state
    clearTokens();
    setToken(null);
    setUser(null);
    appDispatch({ type: 'LOGOUT' });
    
    // Logout from Keycloak
    keycloak.logout({
      redirectUri: window.location.origin + '/login',
    });
  }, [appDispatch]);

  /**
   * Check if user has a specific role
   * 
   * @param role - Role to check
   * @returns True if user has the role
   */
  const hasRole = useCallback((role: string): boolean => {
    return user?.roles?.includes(role) || false;
  }, [user]);

  /**
   * Check if user is admin
   */
  const isAdmin = hasRole('admin');
  
  const isAuthenticated = !!user && !!token && !!keycloak.authenticated;

  const contextValue: AuthContextType = {
    user,
    token,
    login,
    logout,
    isLoadingAuth,
    isAuthenticated,
    hasRole,
    isAdmin,
  };
  
  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
