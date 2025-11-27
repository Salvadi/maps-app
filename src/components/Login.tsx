import React, { useState } from 'react';
import { login, User } from '../db';
import './Login.css';

interface LoginProps {
  onLogin: (user: User) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const user = await login(email, password);

      if (user) {
        onLogin(user);
      } else {
        setError('Invalid email or password');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('An error occurred during login');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = () => {
    alert('Password reset functionality will be implemented in Phase 3 with Supabase Auth');
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <h1 className="login-title">Login</h1>

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
              autoComplete="current-password"
              disabled={isLoading}
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

          <button
            type="submit"
            className="login-button"
            disabled={isLoading}
          >
            {isLoading ? 'Accesso in corso...' : 'Accedi'}
          </button>

          <button
            type="button"
            className="reset-link"
            onClick={handleResetPassword}
            disabled={isLoading}
          >
            Reset password
          </button>
        </form>

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
      </div>
    </div>
  );
};

export default Login;
