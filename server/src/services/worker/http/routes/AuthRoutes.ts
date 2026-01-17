/**
 * AuthRoutes - Authentication endpoints
 * Handles user registration, login, token refresh, and logout
 */

import { Application, Request, Response } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { authService } from '../../../auth/index.js';
import { jwtAuthMiddleware } from '../../../server/AuthMiddleware.js';
import { logger } from '../../../../utils/logger.js';

export class AuthRoutes extends BaseRouteHandler {
  setupRoutes(app: Application): void {
    // Public routes
    app.post('/api/auth/register', this.wrapHandler(this.handleRegister.bind(this)));
    app.post('/api/auth/login', this.wrapHandler(this.handleLogin.bind(this)));
    app.post('/api/auth/refresh', this.wrapHandler(this.handleRefresh.bind(this)));
    app.post('/api/auth/logout', this.wrapHandler(this.handleLogout.bind(this)));

    // Protected routes
    app.get('/api/auth/me', jwtAuthMiddleware, this.wrapHandler(this.handleGetMe.bind(this)));
    app.put('/api/auth/password', jwtAuthMiddleware, this.wrapHandler(this.handleChangePassword.bind(this)));
  }

  /**
   * POST /api/auth/register
   * Register a new user (first user becomes admin)
   */
  private async handleRegister(req: Request, res: Response): Promise<void> {
    if (!this.validateRequired(req, res, ['username', 'password'])) {
      return;
    }

    const { username, password } = req.body;

    try {
      const result = await authService.register(username, password);
      logger.info('Auth', `User registered: ${username}`);
      res.status(201).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';
      if (message.includes('already exists') || message.includes('must be')) {
        res.status(400).json({ error: message });
      } else {
        throw error;
      }
    }
  }

  /**
   * POST /api/auth/login
   * Authenticate user and return tokens
   */
  private async handleLogin(req: Request, res: Response): Promise<void> {
    if (!this.validateRequired(req, res, ['username', 'password'])) {
      return;
    }

    const { username, password } = req.body;

    try {
      const result = await authService.login(username, password);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      if (message.includes('Invalid') || message.includes('disabled')) {
        res.status(401).json({ error: message });
      } else {
        throw error;
      }
    }
  }

  /**
   * POST /api/auth/refresh
   * Refresh access token using refresh token
   */
  private async handleRefresh(req: Request, res: Response): Promise<void> {
    if (!this.validateRequired(req, res, ['refreshToken'])) {
      return;
    }

    const { refreshToken } = req.body;

    try {
      const result = await authService.refreshToken(refreshToken);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Token refresh failed';
      if (message.includes('Invalid') || message.includes('expired')) {
        res.status(401).json({ error: message });
      } else {
        throw error;
      }
    }
  }

  /**
   * POST /api/auth/logout
   * Invalidate refresh token
   */
  private async handleLogout(req: Request, res: Response): Promise<void> {
    const { refreshToken } = req.body;

    if (refreshToken) {
      await authService.logout(refreshToken);
    }

    res.json({ success: true });
  }

  /**
   * GET /api/auth/me
   * Get current user info (protected)
   */
  private async handleGetMe(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const user = await authService.getUserById(req.user.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      id: user._id?.toString(),
      username: user.username,
      role: user.role,
      created_at: user.created_at,
      last_login_at: user.last_login_at,
    });
  }

  /**
   * PUT /api/auth/password
   * Change password (protected)
   */
  private async handleChangePassword(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!this.validateRequired(req, res, ['oldPassword', 'newPassword'])) {
      return;
    }

    const { oldPassword, newPassword } = req.body;

    try {
      await authService.changePassword(req.user.userId, oldPassword, newPassword);
      res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Password change failed';
      if (message.includes('incorrect') || message.includes('must be')) {
        res.status(400).json({ error: message });
      } else {
        throw error;
      }
    }
  }
}
