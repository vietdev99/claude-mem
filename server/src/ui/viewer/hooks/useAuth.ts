import { useState, useEffect, useCallback } from 'react';
import { API_ENDPOINTS } from '../constants/api';

interface User {
  id: string;
  username: string;
  role: 'member' | 'admin';
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  isLoading: boolean;
  error: string | null;
}

const STORAGE_KEY = 'claude-mem-auth';

function loadFromStorage(): { user: User | null; tokens: AuthTokens | null } {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch {
    // Ignore parse errors
  }
  return { user: null, tokens: null };
}

function saveToStorage(user: User | null, tokens: AuthTokens | null): void {
  if (user && tokens) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ user, tokens }));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function useAuth() {
  const [state, setState] = useState<AuthState>(() => {
    const { user, tokens } = loadFromStorage();
    return {
      user,
      tokens,
      isLoading: false,
      error: null,
    };
  });

  // Check if token is still valid on mount
  useEffect(() => {
    if (state.tokens) {
      verifyToken();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const verifyToken = useCallback(async () => {
    if (!state.tokens?.accessToken) return;

    try {
      const response = await fetch(API_ENDPOINTS.AUTH_ME, {
        headers: {
          'Authorization': `Bearer ${state.tokens.accessToken}`,
        },
      });

      if (!response.ok) {
        // Token invalid, try to refresh
        await refreshToken();
      }
    } catch {
      // Network error, keep current state
    }
  }, [state.tokens]);

  const refreshToken = useCallback(async () => {
    if (!state.tokens?.refreshToken) {
      logout();
      return;
    }

    try {
      const response = await fetch(API_ENDPOINTS.AUTH_REFRESH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: state.tokens.refreshToken }),
      });

      if (response.ok) {
        const newTokens = await response.json();
        setState(prev => {
          const updated = {
            ...prev,
            tokens: newTokens,
          };
          saveToStorage(prev.user, newTokens);
          return updated;
        });
      } else {
        logout();
      }
    } catch {
      logout();
    }
  }, [state.tokens]);

  const login = useCallback(async (username: string, password: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await fetch(API_ENDPOINTS.AUTH_LOGIN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      setState({
        user: data.user,
        tokens: data.tokens,
        isLoading: false,
        error: null,
      });
      saveToStorage(data.user, data.tokens);
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Login failed',
      }));
      throw error;
    }
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await fetch(API_ENDPOINTS.AUTH_REGISTER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }

      setState({
        user: data.user,
        tokens: data.tokens,
        isLoading: false,
        error: null,
      });
      saveToStorage(data.user, data.tokens);
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Registration failed',
      }));
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    if (state.tokens?.refreshToken) {
      try {
        await fetch(API_ENDPOINTS.AUTH_LOGOUT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: state.tokens.refreshToken }),
        });
      } catch {
        // Ignore logout errors
      }
    }

    setState({
      user: null,
      tokens: null,
      isLoading: false,
      error: null,
    });
    saveToStorage(null, null);
  }, [state.tokens]);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  return {
    user: state.user,
    tokens: state.tokens,
    isLoading: state.isLoading,
    error: state.error,
    isAuthenticated: !!state.user,
    isAdmin: state.user?.role === 'admin',
    login,
    register,
    logout,
    refreshToken,
    clearError,
    getAuthHeader: () => state.tokens?.accessToken ? { 'Authorization': `Bearer ${state.tokens.accessToken}` } : {},
  };
}
