import React, { useState, useEffect } from 'react';
import { login, signUp, User } from '../db';
import { isSupabaseConfigured } from '../lib/supabase';
import './Login.css';

interface LoginProps {
  onLogin: (user: User) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [supabaseEnabled, setSupabaseEnabled] = useState(false);

  useEffect(() => {
    setSupabaseEnabled(isSupabaseConfigured());
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsLoading(true);

    try {
      if (mode === 'signup') {
        // Sign up mode
        const user = await signUp(email, password);
        if (user) {
          setSuccess('Account created! Please check your email to verify your account, then login.');
          setMode('login');
          setEmail('');
          setPassword('');
        } else {
          setError('Failed to create account. Please try again.');
        }
      } else {
        // Login mode
        const user = await login(email, password);
        if (user) {
          onLogin(user);
        } else {
          setError('Invalid email or password');
        }
      }
    } catch (err) {
      console.error('Auth error:', err);
      setError(`An error occurred during ${mode === 'signup' ? 'sign up' : 'login'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = () => {
    if (supabaseEnabled) {
      alert('Password reset link will be sent to your email (Supabase Auth)');
      // TODO: Implement with supabase.auth.resetPasswordForEmail()
    } else {
      alert('Password reset requires Supabase configuration. Running in offline-only mode.');
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        {/* Status Indicator */}
        <div style={{
          marginBottom: '16px',
          padding: '8px 12px',
          backgroundColor: supabaseEnabled ? '#E8F5E9' : '#FFF3E0',
          borderRadius: '8px',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: supabaseEnabled ? '#2E7D32' : '#E65100'
        }}>
          {supabaseEnabled ? '🟢 Supabase Connected' : '🔴 Offline Mode'}
        </div>

        <h1 className="login-title">
          {mode === 'login' ? 'Login' : 'Sign Up'}
        </h1>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-field">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="login-input"
              required
              autoComplete="email"
              disabled={isLoading}
            />
          </div>

          <div className="form-field">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="login-input"
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              disabled={isLoading}
              minLength={mode === 'signup' ? 6 : undefined}
            />
          </div>

          {error && (
            <div className="error-message" style={{
              color: '#C97A7A',
              textAlign: 'center',
              marginTop: '8px',
              fontSize: '0.875rem'
            }}>
              {error}
            </div>
          )}

          {success && (
            <div style={{
              color: '#4CAF50',
              textAlign: 'center',
              marginTop: '8px',
              fontSize: '0.875rem'
            }}>
              {success}
            </div>
          )}

          <button
            type="submit"
            className="login-button"
            disabled={isLoading}
          >
            {isLoading
              ? (mode === 'login' ? 'Accesso in corso...' : 'Creating account...')
              : (mode === 'login' ? 'Accedi' : 'Sign Up')
            }
          </button>

          {mode === 'login' && (
            <button
              type="button"
              className="reset-link"
              onClick={handleResetPassword}
              disabled={isLoading}
            >
              Reset password
            </button>
          )}

          {/* Mode Toggle */}
          {supabaseEnabled && (
            <div style={{
              marginTop: '16px',
              textAlign: 'center',
              fontSize: '0.875rem'
            }}>
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'login' ? 'signup' : 'login');
                  setError('');
                  setSuccess('');
                }}
                disabled={isLoading}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-primary)',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  fontSize: '0.875rem'
                }}
              >
                {mode === 'login'
                  ? 'Need an account? Sign up'
                  : 'Already have an account? Login'
                }
              </button>
            </div>
          )}
        </form>

        {!supabaseEnabled && (
          <div className="login-hint" style={{
            marginTop: '24px',
            padding: '16px',
            backgroundColor: 'var(--color-bg-input)',
            borderRadius: '8px',
            textAlign: 'center'
          }}>
            <p style={{
              color: 'var(--color-text-secondary)',
              fontSize: '0.875rem',
              margin: 0
            }}>
              <strong>Demo accounts:</strong><br />
              Admin: admin@example.com (any password)<br />
              User: user@example.com (any password)
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;
