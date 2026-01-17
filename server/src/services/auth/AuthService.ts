/**
 * Authentication service - handles user registration, login, and token management
 * Uses MongoDB for user storage
 */

import { ObjectId } from 'mongodb';
import { mongoConnection } from './MongoConnection.js';
import { PasswordService } from './PasswordService.js';
import { jwtService } from './JwtService.js';
import { User, RefreshToken, LoginResponse, RegisterResponse, JwtPayload } from './types.js';
import { logger } from '../../utils/logger.js';

export class AuthService {
  /**
   * Register a new user
   * First user automatically becomes admin
   */
  async register(username: string, password: string): Promise<RegisterResponse> {
    // Validate username
    if (!username || username.length < 3 || username.length > 50) {
      throw new Error('Username must be between 3 and 50 characters');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      throw new Error('Username can only contain letters, numbers, underscores, and hyphens');
    }

    // Validate password
    const passwordCheck = PasswordService.validateStrength(password);
    if (!passwordCheck.valid) {
      throw new Error(passwordCheck.message);
    }

    const users = await mongoConnection.getUsersCollection();

    // Check if username already exists
    const existingUser = await users.findOne({ username });
    if (existingUser) {
      throw new Error('Username already exists');
    }

    // Check if this is the first user (will be admin)
    const userCount = await users.countDocuments();
    const role = userCount === 0 ? 'admin' : 'member';

    // Hash password
    const password_hash = await PasswordService.hash(password);

    // Create user
    const now = new Date();
    const newUser: User = {
      username,
      password_hash,
      role,
      created_at: now,
      is_active: true,
    };

    const result = await users.insertOne(newUser);
    const userId = result.insertedId.toString();

    logger.info('Auth', `User registered: ${username} (${role})`);

    // Generate tokens
    const payload: JwtPayload = {
      userId,
      username,
      role,
    };
    const tokens = await jwtService.generateTokens(payload);

    // Store refresh token
    await this.storeRefreshToken(userId, tokens.refreshToken);

    return {
      user: {
        id: userId,
        username,
        role,
      },
      tokens,
    };
  }

  /**
   * Login a user
   */
  async login(username: string, password: string): Promise<LoginResponse> {
    const users = await mongoConnection.getUsersCollection();

    // Find user
    const user = await users.findOne({ username });
    if (!user) {
      throw new Error('Invalid username or password');
    }

    // Check if user is active
    if (!user.is_active) {
      throw new Error('Account is disabled');
    }

    // Verify password
    const isValid = await PasswordService.verify(password, user.password_hash);
    if (!isValid) {
      throw new Error('Invalid username or password');
    }

    const userId = user._id!.toString();

    // Update last login
    await users.updateOne(
      { _id: user._id },
      { $set: { last_login_at: new Date() } }
    );

    logger.info('Auth', `User logged in: ${username}`);

    // Generate tokens
    const payload: JwtPayload = {
      userId,
      username: user.username,
      role: user.role,
    };
    const tokens = await jwtService.generateTokens(payload);

    // Store refresh token
    await this.storeRefreshToken(userId, tokens.refreshToken);

    return {
      user: {
        id: userId,
        username: user.username,
        role: user.role,
      },
      tokens,
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const refreshTokens = await mongoConnection.getRefreshTokensCollection();

    // Find refresh token
    const tokenDoc = await refreshTokens.findOne({ token: refreshToken });
    if (!tokenDoc) {
      throw new Error('Invalid refresh token');
    }

    // Check if expired
    if (new Date() > tokenDoc.expires_at) {
      // Clean up expired token
      await refreshTokens.deleteOne({ _id: tokenDoc._id });
      throw new Error('Refresh token expired');
    }

    // Get user
    const users = await mongoConnection.getUsersCollection();
    const user = await users.findOne({ _id: new ObjectId(tokenDoc.user_id) });
    if (!user || !user.is_active) {
      throw new Error('User not found or disabled');
    }

    // Delete old refresh token
    await refreshTokens.deleteOne({ _id: tokenDoc._id });

    // Generate new tokens
    const payload: JwtPayload = {
      userId: user._id!.toString(),
      username: user.username,
      role: user.role,
    };
    const tokens = await jwtService.generateTokens(payload);

    // Store new refresh token
    await this.storeRefreshToken(user._id!.toString(), tokens.refreshToken);

    logger.debug('Auth', `Token refreshed for user: ${user.username}`);

    return tokens;
  }

  /**
   * Logout - invalidate refresh token
   */
  async logout(refreshToken: string): Promise<void> {
    const refreshTokens = await mongoConnection.getRefreshTokensCollection();
    await refreshTokens.deleteOne({ token: refreshToken });
    logger.debug('Auth', 'User logged out');
  }

  /**
   * Logout all sessions for a user
   */
  async logoutAll(userId: string): Promise<void> {
    const refreshTokens = await mongoConnection.getRefreshTokensCollection();
    await refreshTokens.deleteMany({ user_id: userId });
    logger.debug('Auth', `All sessions logged out for user: ${userId}`);
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    try {
      const users = await mongoConnection.getUsersCollection();
      return await users.findOne({ _id: new ObjectId(userId) });
    } catch {
      return null;
    }
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username: string): Promise<User | null> {
    const users = await mongoConnection.getUsersCollection();
    return await users.findOne({ username });
  }

  /**
   * Change password
   */
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const users = await mongoConnection.getUsersCollection();
    const user = await users.findOne({ _id: new ObjectId(userId) });
    if (!user) {
      throw new Error('User not found');
    }

    // Verify old password
    const isValid = await PasswordService.verify(oldPassword, user.password_hash);
    if (!isValid) {
      throw new Error('Current password is incorrect');
    }

    // Validate new password
    const passwordCheck = PasswordService.validateStrength(newPassword);
    if (!passwordCheck.valid) {
      throw new Error(passwordCheck.message);
    }

    // Hash and update new password
    const password_hash = await PasswordService.hash(newPassword);
    await users.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { password_hash } }
    );

    // Invalidate all refresh tokens (force re-login)
    await this.logoutAll(userId);

    logger.info('Auth', `Password changed for user: ${user.username}`);
  }

  /**
   * Store a refresh token
   */
  private async storeRefreshToken(userId: string, token: string): Promise<void> {
    const refreshTokens = await mongoConnection.getRefreshTokensCollection();
    const tokenDoc: RefreshToken = {
      user_id: userId,
      token,
      expires_at: jwtService.getRefreshTokenExpiryDate(),
      created_at: new Date(),
    };
    await refreshTokens.insertOne(tokenDoc);
  }

  /**
   * Verify access token and return payload
   */
  async verifyToken(token: string): Promise<JwtPayload | null> {
    return jwtService.verifyAccessToken(token);
  }
}

export const authService = new AuthService();
