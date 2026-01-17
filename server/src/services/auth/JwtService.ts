/**
 * JWT token service for authentication
 */

import { JwtPayload, AuthTokens } from './types.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { logger } from '../../utils/logger.js';

// JWT implementation using Web Crypto API (works in both Bun and Node.js)
class JwtService {
  private getSecret(): string {
    const settings = SettingsDefaultsManager.getInstance();
    const secret = settings.get('CLAUDE_MEM_JWT_SECRET');
    if (!secret) {
      throw new Error('JWT secret not configured. Set CLAUDE_MEM_JWT_SECRET in settings.');
    }
    return secret;
  }

  private getAccessTokenExpiry(): number {
    const settings = SettingsDefaultsManager.getInstance();
    const expiry = settings.get('CLAUDE_MEM_JWT_ACCESS_EXPIRY') || '1h';
    return this.parseExpiry(expiry);
  }

  private getRefreshTokenExpiry(): number {
    const settings = SettingsDefaultsManager.getInstance();
    const expiry = settings.get('CLAUDE_MEM_JWT_REFRESH_EXPIRY') || '7d';
    return this.parseExpiry(expiry);
  }

  private parseExpiry(expiry: string): number {
    const match = expiry.match(/^(\d+)(s|m|h|d)$/);
    if (!match) {
      return 3600; // Default 1 hour
    }
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 3600;
    }
  }

  private base64UrlEncode(data: string | Uint8Array): string {
    const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
    const base64 = Buffer.from(str).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private base64UrlDecode(str: string): string {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    if (pad) {
      base64 += '='.repeat(4 - pad);
    }
    return Buffer.from(base64, 'base64').toString('utf8');
  }

  private async hmacSign(data: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(data);

    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, messageData);
    return this.base64UrlEncode(new Uint8Array(signature).reduce((s, b) => s + String.fromCharCode(b), ''));
  }

  private async hmacVerify(data: string, signature: string, secret: string): Promise<boolean> {
    const expectedSignature = await this.hmacSign(data, secret);
    return signature === expectedSignature;
  }

  /**
   * Generate an access token
   */
  async generateAccessToken(payload: JwtPayload): Promise<string> {
    const secret = this.getSecret();
    const expiresIn = this.getAccessTokenExpiry();
    const now = Math.floor(Date.now() / 1000);

    const header = { alg: 'HS256', typ: 'JWT' };
    const tokenPayload = {
      ...payload,
      iat: now,
      exp: now + expiresIn,
    };

    const headerB64 = this.base64UrlEncode(JSON.stringify(header));
    const payloadB64 = this.base64UrlEncode(JSON.stringify(tokenPayload));
    const data = `${headerB64}.${payloadB64}`;
    const signature = await this.hmacSign(data, secret);

    return `${data}.${signature}`;
  }

  /**
   * Generate a refresh token (random string)
   */
  generateRefreshToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Generate both access and refresh tokens
   */
  async generateTokens(payload: JwtPayload): Promise<AuthTokens> {
    const accessToken = await this.generateAccessToken(payload);
    const refreshToken = this.generateRefreshToken();
    const expiresIn = this.getAccessTokenExpiry();

    return {
      accessToken,
      refreshToken,
      expiresIn,
    };
  }

  /**
   * Verify and decode an access token
   */
  async verifyAccessToken(token: string): Promise<JwtPayload | null> {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }

      const [headerB64, payloadB64, signature] = parts;
      const secret = this.getSecret();

      // Verify signature
      const data = `${headerB64}.${payloadB64}`;
      const isValid = await this.hmacVerify(data, signature, secret);
      if (!isValid) {
        logger.debug('JWT', 'Invalid signature');
        return null;
      }

      // Decode payload
      const payload = JSON.parse(this.base64UrlDecode(payloadB64)) as JwtPayload;

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        logger.debug('JWT', 'Token expired');
        return null;
      }

      return payload;
    } catch (error) {
      logger.error('JWT', `Token verification failed: ${error}`);
      return null;
    }
  }

  /**
   * Get refresh token expiry date
   */
  getRefreshTokenExpiryDate(): Date {
    const expiresIn = this.getRefreshTokenExpiry();
    return new Date(Date.now() + expiresIn * 1000);
  }
}

export const jwtService = new JwtService();
