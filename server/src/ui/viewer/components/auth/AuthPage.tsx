import React, { useState } from 'react';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';

interface AuthPageProps {
  onLogin: (username: string, password: string) => Promise<void>;
  onRegister: (username: string, password: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function AuthPage({ onLogin, onRegister, isLoading, error }: AuthPageProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');

  if (mode === 'register') {
    return (
      <RegisterForm
        onRegister={onRegister}
        onSwitchToLogin={() => setMode('login')}
        isLoading={isLoading}
        error={error}
      />
    );
  }

  return (
    <LoginForm
      onLogin={onLogin}
      onSwitchToRegister={() => setMode('register')}
      isLoading={isLoading}
      error={error}
    />
  );
}
