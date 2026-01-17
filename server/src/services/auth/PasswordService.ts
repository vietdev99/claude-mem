/**
 * Password hashing service using bcrypt
 */

// Use Bun's built-in password hashing if available, otherwise fallback
const SALT_ROUNDS = 12;

export class PasswordService {
  /**
   * Hash a password using bcrypt
   */
  static async hash(password: string): Promise<string> {
    // Bun has native Bun.password API
    if (typeof Bun !== 'undefined' && Bun.password) {
      return await Bun.password.hash(password, {
        algorithm: 'bcrypt',
        cost: SALT_ROUNDS,
      });
    }

    // Fallback for Node.js - dynamic import to avoid bundling issues
    const bcrypt = await import('bcryptjs');
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  /**
   * Verify a password against a hash
   */
  static async verify(password: string, hash: string): Promise<boolean> {
    // Bun has native Bun.password API
    if (typeof Bun !== 'undefined' && Bun.password) {
      return await Bun.password.verify(password, hash);
    }

    // Fallback for Node.js
    const bcrypt = await import('bcryptjs');
    return bcrypt.compare(password, hash);
  }

  /**
   * Validate password strength
   */
  static validateStrength(password: string): { valid: boolean; message?: string } {
    if (password.length < 6) {
      return { valid: false, message: 'Password must be at least 6 characters long' };
    }
    if (password.length > 128) {
      return { valid: false, message: 'Password must be less than 128 characters' };
    }
    return { valid: true };
  }
}
