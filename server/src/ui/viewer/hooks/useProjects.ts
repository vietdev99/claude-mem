import { useState, useEffect, useCallback } from 'react';

export interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
  visibility: 'private' | 'team' | 'public';
  role: 'owner' | 'admin' | 'member' | 'viewer';
  member_count?: number;
  created_at?: string;
}

interface UseProjectsResult {
  projects: Project[];
  currentProject: Project | null;
  setCurrentProject: (project: Project | null) => void;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createProject: (name: string, description?: string, visibility?: string) => Promise<Project>;
}

const STORAGE_KEY = 'claude-mem-current-project';

export function useProjects(accessToken: string | null): UseProjectsResult {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProjectState] = useState<Project | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setCurrentProject = useCallback((project: Project | null) => {
    setCurrentProjectState(project);
    if (project) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!accessToken) {
      setProjects([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/projects', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch projects');
      }

      const data = await response.json();
      setProjects(data.projects || []);

      // Auto-select first project if none selected
      if (data.projects?.length > 0 && !currentProject) {
        setCurrentProject(data.projects[0]);
      }

      // Update current project if it exists in the new list
      if (currentProject && data.projects) {
        const updated = data.projects.find((p: Project) => p.id === currentProject.id);
        if (updated) {
          setCurrentProject(updated);
        } else if (data.projects.length > 0) {
          // Current project no longer exists, select first
          setCurrentProject(data.projects[0]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch projects');
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, currentProject, setCurrentProject]);

  const createProject = useCallback(async (
    name: string,
    description?: string,
    visibility: string = 'team'
  ): Promise<Project> => {
    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, description, visibility }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to create project');
    }

    const project = await response.json();

    // Refresh projects list and select the new project
    await refresh();
    setCurrentProject(project);

    return project;
  }, [accessToken, refresh, setCurrentProject]);

  // Fetch projects on mount and when token changes
  useEffect(() => {
    if (accessToken) {
      refresh();
    }
  }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    projects,
    currentProject,
    setCurrentProject,
    isLoading,
    error,
    refresh,
    createProject,
  };
}
