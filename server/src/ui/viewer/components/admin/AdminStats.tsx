import React, { useState, useEffect, useCallback } from 'react';
import { API_ENDPOINTS } from '../../constants/api';

interface Stats {
  users: {
    total: number;
    active: number;
    admins: number;
  };
  data: {
    observations: number;
    summaries: number;
    prompts: number;
    projects: number;
  };
}

interface AdminStatsProps {
  getAuthHeader: () => Record<string, string>;
}

export function AdminStats({ getAuthHeader }: AdminStatsProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(API_ENDPOINTS.ADMIN_STATS, {
        headers: getAuthHeader(),
      });
      if (!response.ok) {
        throw new Error('Failed to fetch statistics');
      }
      const data = await response.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch statistics');
    } finally {
      setIsLoading(false);
    }
  }, [getAuthHeader]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (isLoading) {
    return (
      <div className="admin-loading">
        <div className="spinner"></div>
        <span>Loading statistics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-error">
        {error}
        <button onClick={fetchStats}>Retry</button>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="admin-stats">
      <div className="stats-section">
        <h3>Users</h3>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.users.total}</div>
            <div className="stat-label">Total Users</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.users.active}</div>
            <div className="stat-label">Active Users</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.users.admins}</div>
            <div className="stat-label">Administrators</div>
          </div>
        </div>
      </div>

      <div className="stats-section">
        <h3>Data</h3>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.data.observations.toLocaleString()}</div>
            <div className="stat-label">Observations</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.data.summaries.toLocaleString()}</div>
            <div className="stat-label">Summaries</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.data.prompts.toLocaleString()}</div>
            <div className="stat-label">User Prompts</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.data.projects}</div>
            <div className="stat-label">Projects</div>
          </div>
        </div>
      </div>

      <div className="stats-refresh">
        <button onClick={fetchStats} className="refresh-btn">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
          Refresh Stats
        </button>
      </div>
    </div>
  );
}
