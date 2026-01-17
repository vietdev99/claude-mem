/**
 * Authentication types for Claude-Mem
 * Users are stored in MongoDB, linked to SQLite data via user_id
 */

export interface User {
  _id?: string;
  username: string;
  password_hash: string;
  role: 'member' | 'admin';
  created_at: Date;
  last_login_at?: Date;
  is_active: boolean;
}

export interface RefreshToken {
  _id?: string;
  user_id: string;
  token: string;
  expires_at: Date;
  created_at: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface JwtPayload {
  userId: string;
  username: string;
  role: 'member' | 'admin';
  iat?: number;
  exp?: number;
}

export interface LoginResponse {
  user: {
    id: string;
    username: string;
    role: 'member' | 'admin';
  };
  tokens: AuthTokens;
}

export interface RegisterResponse {
  user: {
    id: string;
    username: string;
    role: 'member' | 'admin';
  };
  tokens: AuthTokens;
}
