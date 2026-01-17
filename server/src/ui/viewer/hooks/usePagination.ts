import { useState, useCallback, useRef } from 'react';
import { Observation, Summary, UserPrompt } from '../types';
import { UI } from '../constants/ui';

interface PaginationState {
  isLoading: boolean;
  hasMore: boolean;
}

type DataType = 'observations' | 'summaries' | 'prompts';
type DataItem = Observation | Summary | UserPrompt;

/**
 * Generic pagination hook for MongoDB project data
 */
function usePaginationFor(
  dataType: DataType,
  projectId: string | null,
  accessToken: string | null
) {
  const [state, setState] = useState<PaginationState>({
    isLoading: false,
    hasMore: true
  });

  const offsetRef = useRef(0);
  const lastProjectRef = useRef(projectId);
  const stateRef = useRef(state);

  const loadMore = useCallback(async (): Promise<DataItem[]> => {
    // No project selected = no data to load
    if (!projectId || !accessToken) {
      setState({ isLoading: false, hasMore: false });
      return [];
    }

    // Check if project changed - reset pagination
    const projectChanged = lastProjectRef.current !== projectId;

    if (projectChanged) {
      offsetRef.current = 0;
      lastProjectRef.current = projectId;
      const newState = { isLoading: false, hasMore: true };
      setState(newState);
      stateRef.current = newState;
    }

    // Prevent concurrent requests
    if (!projectChanged && (stateRef.current.isLoading || !stateRef.current.hasMore)) {
      return [];
    }

    setState(prev => ({ ...prev, isLoading: true }));
    stateRef.current = { ...stateRef.current, isLoading: true };

    try {
      const params = new URLSearchParams({
        offset: offsetRef.current.toString(),
        limit: UI.PAGINATION_PAGE_SIZE.toString()
      });

      const response = await fetch(`/api/projects/${projectId}/${dataType}?${params}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to load ${dataType}: ${response.statusText}`);
      }

      const data = await response.json() as { items: DataItem[], hasMore: boolean };

      const newState = { isLoading: false, hasMore: data.hasMore };
      setState(newState);
      stateRef.current = newState;

      offsetRef.current += UI.PAGINATION_PAGE_SIZE;

      return data.items;
    } catch (error) {
      setState(prev => ({ ...prev, isLoading: false }));
      stateRef.current = { ...stateRef.current, isLoading: false };
      throw error;
    }
  }, [projectId, accessToken, dataType]);

  // Reset when project changes
  const reset = useCallback(() => {
    offsetRef.current = 0;
    setState({ isLoading: false, hasMore: true });
    stateRef.current = { isLoading: false, hasMore: true };
  }, []);

  return {
    ...state,
    loadMore,
    reset
  };
}

/**
 * Hook for paginating observations, summaries, and prompts from MongoDB
 * @param projectId - MongoDB project ID
 * @param accessToken - JWT access token
 */
export function usePagination(
  projectId: string | null,
  accessToken: string | null
) {
  const observations = usePaginationFor('observations', projectId, accessToken);
  const summaries = usePaginationFor('summaries', projectId, accessToken);
  const prompts = usePaginationFor('prompts', projectId, accessToken);

  return {
    observations,
    summaries,
    prompts
  };
}
