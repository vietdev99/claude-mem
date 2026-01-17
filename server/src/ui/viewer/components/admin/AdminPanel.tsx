import React, { useState, useEffect, useCallback } from 'react';
import { API_ENDPOINTS } from '../../constants/api';
import { UserManagement } from './UserManagement';
import { AdminStats } from './AdminStats';

interface AdminPanelProps {
  accessToken: string;
  onClose: () => void;
}

export function AdminPanel({ accessToken, onClose }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<'users' | 'stats'>('users');

  const getAuthHeader = () => ({
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  });

  return (
    <div className="admin-panel-overlay" onClick={onClose}>
      <div className="admin-panel" onClick={(e) => e.stopPropagation()}>
        <div className="admin-panel-header">
          <h2>Admin Panel</h2>
          <button className="admin-close-btn" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="admin-tabs">
          <button
            className={`admin-tab ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            Users
          </button>
          <button
            className={`admin-tab ${activeTab === 'stats' ? 'active' : ''}`}
            onClick={() => setActiveTab('stats')}
          >
            Statistics
          </button>
        </div>

        <div className="admin-content">
          {activeTab === 'users' && (
            <UserManagement getAuthHeader={getAuthHeader} />
          )}
          {activeTab === 'stats' && (
            <AdminStats getAuthHeader={getAuthHeader} />
          )}
        </div>
      </div>
    </div>
  );
}
