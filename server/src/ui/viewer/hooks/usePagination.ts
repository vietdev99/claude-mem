import { useState, useCallback, useRef } from 'react';
import { Observation, Summary, UserPrompt } from '../types';
import { UI } from '../constants/ui';
import { API_ENDPOINTS } from '../constants/api';

interface PaginationState {
  isLoading: boolean;
  hasMore: boolean;
}

type DataType = 'observations' | 'summaries' | 'prompts';
type DataItem = Observation | Summary | UserPrompt;

interface PaginationOptions {
  projectId?: string | null;
  accessToken?: string | null;
}

/**
 * Generic pagination hook for observations, summaries, and prompts
 * Supports both legacy SQLite endpoints and MongoDB project endpoints
 */
function usePaginationFor(
  legacyEndpoint: string,
  dataType: DataType,
  currentFilter: string,
  options: PaginationOptions = {}
) {
  const { projectId, accessToken } = options;
  const [state, setState] = useState<PaginationState>({
    isLoading: false,
    hasMore: true
  });

  // Track offset and filter/project in refs to handle synchronous resets
  const offsetRef = useRef(0);
  const lastFilterRef = useRef(currentFilter);
  const lastProjectRef = useRef(projectId);
  const stateRef = useRef(state);

  /**
   * Load more items from the API
   * Automatically resets offset to 0 if filter or project has changed
   */
  const loadMore = useCallback(async (): Promise<DataItem[]> => {
    // Check if filter or project changed - if so, reset pagination synchronously
    const filterChanged = lastFilterRef.current !== currentFilter;
    const projectChanged = lastProjectRef.current !== projectId;

    if (filterChanged || projectChanged) {
      offsetRef.current = 0;
      lastFilterRef.current = currentFilter;
      lastProjectRef.current = projectId;

      // Reset state both in React state and ref synchronously
      const newState = { isLoading: false, hasMore: true };
      setState(newState);
      stateRef.current = newState;  // Update ref immediately to avoid stale checks
    }

    // Prevent concurrent requests using ref (always current)
    // Skip this check if we just reset the filter - we want to load the first page
    if (!filterChanged && !projectChanged && (stateRef.current.isLoading || !stateRef.current.hasMore)) {
      return [];
    }

    setState(prev => ({ ...prev, isLoading: true }));

    // Build query params using current offset from ref
    const params = new URLSearchParams({
      offset: offsetRef.current.toString(),
      limit: UI.PAGINATION_PAGE_SIZE.toString()
    });

    // Determine endpoint: MongoDB project API or legacy SQLite
    let endpoint: string;
    const headers: Record<string, string> = {};

    if (projectId && accessToken) {
      // Use MongoDB project endpoint with auth
      endpoint = `/api/projects/${projectId}/${dataType}`;
      headers['Authorization'] = `Bearer ${accessToken}`;
    } else {
      // Use legacy SQLite endpoint
      endpoint = legacyEndpoint;
      // Add project filter if present (for legacy)
      if (currentFilter) {
        params.append('project', currentFilter);
      }
    }

    const response = await fetch(`${endpoint}?${params}`, { headers });

    if (!response.ok) {
      throw new Error(`Failed to load ${dataType}: ${response.statusText}`);
    }

    const data = await response.json() as { items: DataItem[], hasMore: boolean };

    setState(prev => ({
      ...prev,
      isLoading: false,
      hasMore: data.hasMore
    }));

    // Increment offset after successful load
    offsetRef.current += UI.PAGINATION_PAGE_SIZE;

    return data.items;
  }, [currentFilter, projectId, accessToken, legacyEndpoint, dataType]);

  return {
    ...state,
    loadMore
  };
}

/**
 * Hook for paginating observations, summaries, and prompts
 * @param currentFilter - Legacy folder-based project filter
 * @param projectId - MongoDB project ID (takes precedence)
 * @param accessToken - JWT access token for MongoDB API
 */
export function usePagination(
  currentFilter: string,
  projectId?: string | null,
  accessToken?: string | null
) {
  const options = { projectId, accessToken };

  const observations = usePaginationFor(API_ENDPOINTS.OBSERVATIONS, 'observations', currentFilter, options);
  const summaries = usePaginationFor(API_ENDPOINTS.SUMMARIES, 'summaries', currentFilter, options);
  const prompts = usePaginationFor(API_ENDPOINTS.PROMPTS, 'prompts', currentFilter, options);

  return {
    observations,
    summaries,
    prompts
  };
}
