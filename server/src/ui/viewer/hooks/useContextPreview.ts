import { useState, useEffect, useCallback } from 'react';
import type { Settings } from '../types';
import type { Project } from './useProjects';

interface UseContextPreviewResult {
  preview: string;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  selectedProject: Project | null;
  setSelectedProject: (project: Project | null) => void;
}

interface UseContextPreviewProps {
  settings: Settings;
  projects: Project[];
  currentProject: Project | null;
  accessToken: string | null;
}

export function useContextPreview({ settings, projects, currentProject, accessToken }: UseContextPreviewProps): UseContextPreviewResult {
  const [preview, setPreview] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(currentProject);

  // Update selected project when currentProject changes
  useEffect(() => {
    if (currentProject) {
      setSelectedProject(currentProject);
    } else if (projects.length > 0 && !selectedProject) {
      setSelectedProject(projects[0]);
    }
  }, [currentProject, projects]);

  const refresh = useCallback(async () => {
    if (!selectedProject) {
      setPreview('No project selected');
      return;
    }

    if (!accessToken) {
      setPreview('Please login to view context');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Fetch context from project
      const response = await fetch(`/api/projects/${selectedProject.id}/context`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        // Format context for preview
        const contextLines: string[] = [];

        if (data.observations?.length > 0) {
          contextLines.push(`## Observations (${data.observations.length})`);
          data.observations.forEach((obs: any) => {
            const type = obs.observation_type || 'note';
            contextLines.push(`- [${type}] ${obs.narrative || obs.tool_response || ''}`);
          });
        }

        if (data.summaries?.length > 0) {
          contextLines.push('');
          contextLines.push(`## Summaries (${data.summaries.length})`);
          data.summaries.forEach((sum: any) => {
            contextLines.push(`- ${sum.content || ''}`);
          });
        }

        setPreview(contextLines.length > 0 ? contextLines.join('\n') : 'No context yet. Save some observations!');
      } else {
        setError('Failed to load preview');
      }
    } catch (err) {
      setError('Failed to load preview');
    }

    setIsLoading(false);
  }, [selectedProject, accessToken]);

  // Debounced refresh when settings or selectedProject change
  useEffect(() => {
    const timeout = setTimeout(() => {
      refresh();
    }, 300);
    return () => clearTimeout(timeout);
  }, [settings, refresh]);

  return { preview, isLoading, error, refresh, selectedProject, setSelectedProject };
}
