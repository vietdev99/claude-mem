/**
 * AdminRoutes - Admin-only endpoints
 * Handles user management, system stats, and logs
 */

import { Application, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { mongoConnection } from '../../../auth/MongoConnection.js';
import { PasswordService } from '../../../auth/PasswordService.js';
import { jwtAuthMiddleware, requireAdmin } from '../../../server/AuthMiddleware.js';
import { logger } from '../../../../utils/logger.js';

export class AdminRoutes extends BaseRouteHandler {
  setupRoutes(app: Application): void {
    // All admin routes require authentication and admin role
    const adminMiddleware = [jwtAuthMiddleware, requireAdmin];

    // User management
    app.get('/api/admin/users', ...adminMiddleware, this.wrapHandler(this.handleGetUsers.bind(this)));
    app.post('/api/admin/users', ...adminMiddleware, this.wrapHandler(this.handleCreateUser.bind(this)));
    app.put('/api/admin/users/:id', ...adminMiddleware, this.wrapHandler(this.handleUpdateUser.bind(this)));
    app.delete('/api/admin/users/:id', ...adminMiddleware, this.wrapHandler(this.handleDeleteUser.bind(this)));

    // System stats
    app.get('/api/admin/stats', ...adminMiddleware, this.wrapHandler(this.handleGetStats.bind(this)));
  }

  /**
   * GET /api/admin/users
   * List all users with pagination
   */
  private async handleGetUsers(req: Request, res: Response): Promise<void> {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const users = await mongoConnection.getUsersCollection();

    const [userList, total] = await Promise.all([
      users.find({})
        .project({ password_hash: 0 }) // Exclude password
        .skip(skip)
        .limit(limit)
        .sort({ created_at: -1 })
        .toArray(),
      users.countDocuments()
    ]);

    res.json({
      users: userList.map(u => ({
        id: u._id?.toString(),
        username: u.username,
        role: u.role,
        is_active: u.is_active,
        created_at: u.created_at,
        last_login_at: u.last_login_at,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      }
    });
  }

  /**
   * POST /api/admin/users
   * Create a new user (admin can specify role)
   */
  private async handleCreateUser(req: Request, res: Response): Promise<void> {
    if (!this.validateRequired(req, res, ['username', 'password'])) {
      return;
    }

    const { username, password, role = 'member' } = req.body;

    // Validate role
    if (role !== 'member' && role !== 'admin') {
      this.badRequest(res, 'Role must be "member" or "admin"');
      return;
    }

    // Validate username
    if (!/^[a-zA-Z0-9_-]{3,50}$/.test(username)) {
      this.badRequest(res, 'Username must be 3-50 characters, letters/numbers/underscores/hyphens only');
      return;
    }

    // Validate password
    const passwordCheck = PasswordService.validateStrength(password);
    if (!passwordCheck.valid) {
      this.badRequest(res, passwordCheck.message!);
      return;
    }

    const users = await mongoConnection.getUsersCollection();

    // Check if username exists
    const existing = await users.findOne({ username });
    if (existing) {
      this.badRequest(res, 'Username already exists');
      return;
    }

    // Create user
    const password_hash = await PasswordService.hash(password);
    const result = await users.insertOne({
      username,
      password_hash,
      role,
      created_at: new Date(),
      is_active: true,
    });

    logger.info('Admin', `User created by admin: ${username} (${role})`);

    res.status(201).json({
      id: result.insertedId.toString(),
      username,
      role,
      is_active: true,
    });
  }

  /**
   * PUT /api/admin/users/:id
   * Update user (role, is_active, password)
   */
  private async handleUpdateUser(req: Request, res: Response): Promise<void> {
    const userId = req.params.id;

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(userId);
    } catch {
      this.badRequest(res, 'Invalid user ID');
      return;
    }

    const { role, is_active, password } = req.body;
    const updates: Record<string, unknown> = {};

    // Validate and add role update
    if (role !== undefined) {
      if (role !== 'member' && role !== 'admin') {
        this.badRequest(res, 'Role must be "member" or "admin"');
        return;
      }
      updates.role = role;
    }

    // Add is_active update
    if (is_active !== undefined) {
      updates.is_active = Boolean(is_active);
    }

    // Handle password update
    if (password) {
      const passwordCheck = PasswordService.validateStrength(password);
      if (!passwordCheck.valid) {
        this.badRequest(res, passwordCheck.message!);
        return;
      }
      updates.password_hash = await PasswordService.hash(password);
    }

    if (Object.keys(updates).length === 0) {
      this.badRequest(res, 'No updates provided');
      return;
    }

    const users = await mongoConnection.getUsersCollection();
    const result = await users.updateOne(
      { _id: objectId },
      { $set: updates }
    );

    if (result.matchedCount === 0) {
      this.notFound(res, 'User not found');
      return;
    }

    // If password was changed, invalidate all refresh tokens
    if (password) {
      const refreshTokens = await mongoConnection.getRefreshTokensCollection();
      await refreshTokens.deleteMany({ user_id: userId });
    }

    logger.info('Admin', `User updated by admin: ${userId}`);

    res.json({ success: true });
  }

  /**
   * DELETE /api/admin/users/:id
   * Delete user and all their refresh tokens
   */
  private async handleDeleteUser(req: Request, res: Response): Promise<void> {
    const userId = req.params.id;

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(userId);
    } catch {
      this.badRequest(res, 'Invalid user ID');
      return;
    }

    // Prevent self-deletion
    if (req.user?.userId === userId) {
      this.badRequest(res, 'Cannot delete your own account');
      return;
    }

    const users = await mongoConnection.getUsersCollection();
    const result = await users.deleteOne({ _id: objectId });

    if (result.deletedCount === 0) {
      this.notFound(res, 'User not found');
      return;
    }

    // Delete all refresh tokens for this user
    const refreshTokens = await mongoConnection.getRefreshTokensCollection();
    await refreshTokens.deleteMany({ user_id: userId });

    logger.info('Admin', `User deleted by admin: ${userId}`);

    res.json({ success: true });
  }

  /**
   * GET /api/admin/stats
   * Get system statistics
   */
  private async handleGetStats(req: Request, res: Response): Promise<void> {
    const db = await mongoConnection.getDb();
    const users = await mongoConnection.getUsersCollection();

    const [totalUsers, adminCount, activeUsers] = await Promise.all([
      users.countDocuments(),
      users.countDocuments({ role: 'admin' }),
      users.countDocuments({ is_active: true }),
    ]);

    // Get data stats from MongoDB collections (if they exist)
    let observationsCount = 0;
    let summariesCount = 0;
    let promptsCount = 0;
    let projectsCount = 0;

    try {
      const collections = await db.listCollections().toArray();
      const collectionNames = collections.map(c => c.name);

      if (collectionNames.includes('observations')) {
        observationsCount = await db.collection('observations').countDocuments();
      }
      if (collectionNames.includes('summaries')) {
        summariesCount = await db.collection('summaries').countDocuments();
      }
      if (collectionNames.includes('user_prompts')) {
        promptsCount = await db.collection('user_prompts').countDocuments();
      }
      if (collectionNames.includes('projects')) {
        projectsCount = await db.collection('projects').countDocuments();
      }
    } catch (error) {
      logger.debug('Admin', 'Some collections may not exist yet', {}, error as Error);
    }

    res.json({
      users: {
        total: totalUsers,
        active: activeUsers,
        admins: adminCount,
      },
      data: {
        observations: observationsCount,
        summaries: summariesCount,
        prompts: promptsCount,
        projects: projectsCount,
      },
    });
  }
}
