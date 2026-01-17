/**
 * MongoDB connection manager for authentication
 * Uses native MongoDB driver for Bun compatibility
 */

import { MongoClient, Db, Collection } from 'mongodb';
import { logger } from '../../utils/logger.js';
import { User, RefreshToken } from './types.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';

class MongoConnection {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private connectionPromise: Promise<Db> | null = null;

  private getConnectionUrl(): string {
    const settings = SettingsDefaultsManager.getInstance();
    const host = settings.get('CLAUDE_MEM_MONGO_HOST') || 'localhost';
    const port = settings.get('CLAUDE_MEM_MONGO_PORT') || '27017';
    const database = settings.get('CLAUDE_MEM_MONGO_DATABASE') || 'claudemem_db';
    const user = settings.get('CLAUDE_MEM_MONGO_USER') || '';
    const password = settings.get('CLAUDE_MEM_MONGO_PASSWORD') || '';

    if (user && password) {
      return `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}?authSource=admin`;
    }
    return `mongodb://${host}:${port}/${database}`;
  }

  async connect(): Promise<Db> {
    // Return existing connection if available
    if (this.db) {
      return this.db;
    }

    // Return pending connection promise if connection is in progress
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    // Start new connection
    this.connectionPromise = this.doConnect();
    return this.connectionPromise;
  }

  private async doConnect(): Promise<Db> {
    try {
      const settings = SettingsDefaultsManager.getInstance();
      const user = settings.get('CLAUDE_MEM_MONGO_USER') || '';
      const password = settings.get('CLAUDE_MEM_MONGO_PASSWORD') || '';
      const database = settings.get('CLAUDE_MEM_MONGO_DATABASE') || 'claudemem_db';

      // Debug: log credential presence (not values)
      console.log(`[MongoDB] Settings loaded - user: ${user ? 'SET' : 'EMPTY'}, password: ${password ? 'SET' : 'EMPTY'}, database: ${database}`);

      const url = this.getConnectionUrl();
      logger.info('MongoDB', `Connecting to MongoDB at ${url.replace(/:[^:@]+@/, ':***@')}`);

      this.client = new MongoClient(url, {
        maxPoolSize: 10,
        minPoolSize: 1,
        maxIdleTimeMS: 30000,
        connectTimeoutMS: 10000,
        serverSelectionTimeoutMS: 10000,
      });

      await this.client.connect();
      this.db = this.client.db(database);

      // Create indexes
      await this.createIndexes();

      logger.info('MongoDB', 'Connected successfully');
      return this.db;
    } catch (error) {
      logger.error('MongoDB', `Connection failed: ${error}`);
      this.connectionPromise = null;
      throw error;
    }
  }

  private async createIndexes(): Promise<void> {
    if (!this.db) return;

    const users = this.db.collection<User>('users');
    const refreshTokens = this.db.collection<RefreshToken>('refresh_tokens');

    // Users indexes
    await users.createIndex({ username: 1 }, { unique: true });
    await users.createIndex({ role: 1 });
    await users.createIndex({ is_active: 1 });

    // Refresh tokens indexes
    await refreshTokens.createIndex({ user_id: 1 });
    await refreshTokens.createIndex({ token: 1 }, { unique: true });
    await refreshTokens.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }); // TTL index

    logger.debug('MongoDB', 'Indexes created');
  }

  async getDb(): Promise<Db> {
    return this.connect();
  }

  async getUsersCollection(): Promise<Collection<User>> {
    const db = await this.connect();
    return db.collection<User>('users');
  }

  async getRefreshTokensCollection(): Promise<Collection<RefreshToken>> {
    const db = await this.connect();
    return db.collection<RefreshToken>('refresh_tokens');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.connectionPromise = null;
      logger.info('MongoDB', 'Disconnected');
    }
  }

  isConnected(): boolean {
    return this.db !== null;
  }
}

// Singleton instance
export const mongoConnection = new MongoConnection();
