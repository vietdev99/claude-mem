import React, { useState, useEffect, useCallback } from 'react';
import { API_ENDPOINTS } from '../../constants/api';

interface User {
  _id: string;
  username: string;
  role: 'member' | 'admin';
  is_active: boolean;
  created_at: string;
  last_login_at?: string;
}

interface UserManagementProps {
  getAuthHeader: () => Record<string, string>;
}

export function UserManagement({ getAuthHeader }: UserManagementProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(API_ENDPOINTS.ADMIN_USERS, {
        headers: getAuthHeader(),
      });
      if (!response.ok) {
        throw new Error('Failed to fetch users');
      }
      const data = await response.json();
      setUsers(data.users || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch users');
    } finally {
      setIsLoading(false);
    }
  }, [getAuthHeader]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleUpdateRole = async (userId: string, newRole: 'member' | 'admin') => {
    try {
      const response = await fetch(`${API_ENDPOINTS.ADMIN_USERS}/${userId}`, {
        method: 'PUT',
        headers: getAuthHeader(),
        body: JSON.stringify({ role: newRole }),
      });
      if (!response.ok) {
        throw new Error('Failed to update user role');
      }
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
    }
  };

  const handleToggleActive = async (userId: string, isActive: boolean) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.ADMIN_USERS}/${userId}`, {
        method: 'PUT',
        headers: getAuthHeader(),
        body: JSON.stringify({ is_active: !isActive }),
      });
      if (!response.ok) {
        throw new Error('Failed to toggle user status');
      }
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
    }
  };

  const handleDeleteUser = async (userId: string, username: string) => {
    if (!confirm(`Are you sure you want to delete user "${username}"? This action cannot be undone.`)) {
      return;
    }
    try {
      const response = await fetch(`${API_ENDPOINTS.ADMIN_USERS}/${userId}`, {
        method: 'DELETE',
        headers: getAuthHeader(),
      });
      if (!response.ok) {
        throw new Error('Failed to delete user');
      }
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="admin-loading">
        <div className="spinner"></div>
        <span>Loading users...</span>
      </div>
    );
  }

  return (
    <div className="user-management">
      {error && (
        <div className="admin-error">
          {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="user-management-header">
        <h3>Users ({users.length})</h3>
        <button className="admin-btn-primary" onClick={() => setShowCreateForm(true)}>
          + Add User
        </button>
      </div>

      {showCreateForm && (
        <CreateUserForm
          getAuthHeader={getAuthHeader}
          onSuccess={() => {
            setShowCreateForm(false);
            fetchUsers();
          }}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      <div className="users-table">
        <div className="users-table-header">
          <div className="user-col-username">Username</div>
          <div className="user-col-role">Role</div>
          <div className="user-col-status">Status</div>
          <div className="user-col-created">Created</div>
          <div className="user-col-last-login">Last Login</div>
          <div className="user-col-actions">Actions</div>
        </div>

        {users.map((user) => (
          <div key={user._id} className={`users-table-row ${!user.is_active ? 'inactive' : ''}`}>
            <div className="user-col-username">
              <span className="user-username">{user.username}</span>
            </div>
            <div className="user-col-role">
              <select
                value={user.role}
                onChange={(e) => handleUpdateRole(user._id, e.target.value as 'member' | 'admin')}
                className="role-select"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="user-col-status">
              <button
                className={`status-badge ${user.is_active ? 'active' : 'inactive'}`}
                onClick={() => handleToggleActive(user._id, user.is_active)}
              >
                {user.is_active ? 'Active' : 'Inactive'}
              </button>
            </div>
            <div className="user-col-created">
              {formatDate(user.created_at)}
            </div>
            <div className="user-col-last-login">
              {formatDate(user.last_login_at)}
            </div>
            <div className="user-col-actions">
              <button
                className="action-btn delete"
                onClick={() => handleDeleteUser(user._id, user.username)}
                title="Delete user"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>
        ))}

        {users.length === 0 && (
          <div className="users-empty">
            No users found
          </div>
        )}
      </div>
    </div>
  );
}

interface CreateUserFormProps {
  getAuthHeader: () => Record<string, string>;
  onSuccess: () => void;
  onCancel: () => void;
}

function CreateUserForm({ getAuthHeader, onSuccess, onCancel }: CreateUserFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(API_ENDPOINTS.ADMIN_USERS, {
        method: 'POST',
        headers: getAuthHeader(),
        body: JSON.stringify({ username, password, role }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create user');
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="create-user-form">
      <h4>Create New User</h4>
      <form onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="form-row">
          <label>
            Username
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              required
              minLength={3}
            />
          </label>
        </div>

        <div className="form-row">
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
              minLength={6}
            />
          </label>
        </div>

        <div className="form-row">
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </div>

        <div className="form-actions">
          <button type="button" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="submit" className="admin-btn-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Create User'}
          </button>
        </div>
      </form>
    </div>
  );
}
