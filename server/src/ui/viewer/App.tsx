import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { Feed } from './components/Feed';
import { ContextSettingsModal } from './components/ContextSettingsModal';
import { LogsDrawer } from './components/LogsModal';
import { AuthPage } from './components/auth';
import { AdminPanel } from './components/admin';
import { useSettings } from './hooks/useSettings';
import { usePagination } from './hooks/usePagination';
import { useTheme } from './hooks/useTheme';
import { useAuth } from './hooks/useAuth';
import { useProjects } from './hooks/useProjects';
import { Observation, Summary, UserPrompt } from './types';

export function App() {
  const [contextPreviewOpen, setContextPreviewOpen] = useState(false);
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [prompts, setPrompts] = useState<UserPrompt[]>([]);

  // Auth hook must be called first and unconditionally
  const { user, tokens, isAuthenticated, isAdmin, login, register, logout, isLoading: authLoading, error: authError } = useAuth();

  // Other hooks
  const { settings, saveSettings, isSaving, saveStatus } = useSettings();
  const { preference, setThemePreference } = useTheme();
  const { projects, currentProject, setCurrentProject, createProject } = useProjects(tokens?.accessToken || null);
  const pagination = usePagination(currentProject?.id || null, tokens?.accessToken || null);

  // Toggle context preview modal
  const toggleContextPreview = useCallback(() => {
    setContextPreviewOpen(prev => !prev);
  }, []);

  // Toggle logs modal
  const toggleLogsModal = useCallback(() => {
    setLogsModalOpen(prev => !prev);
  }, []);

  // Handle loading more data
  const handleLoadMore = useCallback(async () => {
    if (!currentProject) return;

    try {
      const [newObservations, newSummaries, newPrompts] = await Promise.all([
        pagination.observations.loadMore(),
        pagination.summaries.loadMore(),
        pagination.prompts.loadMore()
      ]);

      if (newObservations.length > 0) {
        setObservations(prev => [...prev, ...newObservations]);
      }
      if (newSummaries.length > 0) {
        setSummaries(prev => [...prev, ...newSummaries]);
      }
      if (newPrompts.length > 0) {
        setPrompts(prev => [...prev, ...newPrompts]);
      }
    } catch (error) {
      console.error('Failed to load more data:', error);
    }
  }, [currentProject, pagination.observations, pagination.summaries, pagination.prompts]);

  // Reset data and load first page when project changes
  useEffect(() => {
    setObservations([]);
    setSummaries([]);
    setPrompts([]);
    if (currentProject) {
      handleLoadMore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.id]);

  // Show auth page if not authenticated (after all hooks)
  if (!isAuthenticated) {
    return (
      <AuthPage
        onLogin={login}
        onRegister={register}
        isLoading={authLoading}
        error={authError}
      />
    );
  }

  return (
    <>
      <Header
        projects={projects}
        currentProject={currentProject}
        onProjectChange={setCurrentProject}
        themePreference={preference}
        onThemeChange={setThemePreference}
        onContextPreviewToggle={toggleContextPreview}
        user={user}
        onLogout={logout}
        onAdminClick={isAdmin ? () => setAdminPanelOpen(true) : undefined}
        onCreateProject={() => {
          const name = prompt('Enter project name:');
          if (name) {
            createProject(name).catch(err => alert(err.message));
          }
        }}
      />

      <Feed
        observations={observations}
        summaries={summaries}
        prompts={prompts}
        onLoadMore={handleLoadMore}
        isLoading={pagination.observations.isLoading || pagination.summaries.isLoading || pagination.prompts.isLoading}
        hasMore={pagination.observations.hasMore || pagination.summaries.hasMore || pagination.prompts.hasMore}
      />

      <ContextSettingsModal
        isOpen={contextPreviewOpen}
        onClose={toggleContextPreview}
        settings={settings}
        onSave={saveSettings}
        isSaving={isSaving}
        saveStatus={saveStatus}
        projects={projects}
        currentProject={currentProject}
        accessToken={tokens?.accessToken || null}
      />

      <button
        className="console-toggle-btn"
        onClick={toggleLogsModal}
        title="Toggle Console"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5"></polyline>
          <line x1="12" y1="19" x2="20" y2="19"></line>
        </svg>
      </button>

      <LogsDrawer
        isOpen={logsModalOpen}
        onClose={toggleLogsModal}
      />

      {adminPanelOpen && tokens?.accessToken && (
        <AdminPanel
          accessToken={tokens.accessToken}
          onClose={() => setAdminPanelOpen(false)}
        />
      )}
    </>
  );
}
