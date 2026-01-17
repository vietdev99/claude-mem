/**
 * Authentication middleware for Express
 * Verifies JWT tokens and attaches user info to request
 */

import { Request, Response, NextFunction } from 'express';
import { authService } from '../auth/index.js';
import { JwtPayload } from '../auth/types.js';
import { logger } from '../../utils/logger.js';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Extract Bearer token from Authorization header
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Required authentication middleware
 * Returns 401 if no valid token is provided
 */
export async function jwtAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const payload = await authService.verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    // Attach user info to request
    req.user = payload;
    next();
  } catch (error) {
    logger.error('Auth', `Middleware error: ${error}`);
    res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Optional authentication middleware
 * Attaches user info if valid token is provided, but doesn't fail if not
 */
export async function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractToken(req);
    if (token) {
      const payload = await authService.verifyToken(token);
      if (payload) {
        req.user = payload;
      }
    }
    next();
  } catch (error) {
    // Don't fail on auth errors in optional mode
    logger.debug('Auth', `Optional auth failed: ${error}`);
    next();
  }
}

/**
 * Role-based authorization middleware
 * Must be used after jwtAuthMiddleware
 */
export function requireRole(role: 'admin' | 'member') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Admin can access everything
    if (req.user.role === 'admin') {
      next();
      return;
    }

    // Member can only access member routes
    if (role === 'member' && req.user.role === 'member') {
      next();
      return;
    }

    res.status(403).json({ error: 'Insufficient permissions' });
  };
}

/**
 * Admin-only middleware
 * Must be used after jwtAuthMiddleware
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  next();
}

/**
 * Get current user ID from request
 * Returns null if not authenticated
 */
export function getCurrentUserId(req: Request): string | null {
  return req.user?.userId ?? null;
}

/**
 * Check if current user is admin
 */
export function isAdmin(req: Request): boolean {
  return req.user?.role === 'admin';
}
