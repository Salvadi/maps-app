import React, { useState, useEffect } from 'react';
import { login, signUp, User, sendPasswordResetEmail } from '../db';
import {
  validateEmail,
  validateUsername,
  validatePasswordStrength,
  getPasswordStrengthLabel,
  getPasswordStrengthColor
} from '../utils/validation';
import './Login.css';

interface LoginProps {
  onLogin: (user: User) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [homeserverEnabled, setHomeserverEnabled] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Validation states
  const [emailError, setEmailError] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [passwordStrength, setPasswordStrength] = useState({
    isValid: false,
    score: 0,
    feedback: [] as string[]
  });

  useEffect(() => {
    setHomeserverEnabled(true);
  }, []);

  // Validate email on change
  useEffect(() => {
    if (email && mode !== 'login') {
      const validation = validateEmail(email);
      setEmailError(validation.error || '');
    } else {
      setEmailError('');
    }
  }, [email, mode]);

  // Validate username on change
  useEffect(() => {
    if (username && mode === 'signup') {
      const validation = validateUsername(username);
      setUsernameError(validation.error || '');
    } else {
      setUsernameError('');
    }
  }, [username, mode]);

  // Validate password on change
  useEffect(() => {
    if (password && mode === 'signup') {
      const strength = validatePasswordStrength(password);
      setPasswordStrength(strength);
    } else {
      setPasswordStrength({ isValid: false, score: 0, feedback: [] });
    }
  }, [password, mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (mode === 'forgot') {
      const emailValidation = validateEmail(email);
      if (!emailValidation.isValid) {
        setError(emailValidation.error || 'Email non valida');
        return;
      }

      setIsLoading(true);
      const result = await sendPasswordResetEmail(email);
      setIsLoading(false);

      if (result.success) {
        setSuccess('Se l\'email è registrata, riceverai un link per reimpostare la password. Controlla la posta.');
        setEmail('');
        setTimeout(() => setMode('login'), 4000);
      } else {
        setError(result.error || 'Invio email di reset fallito');
      }
      return;
    }

    if (mode === 'signup') {
      // Validate all fields for signup
      const emailValidation = validateEmail(email);
      if (!emailValidation.isValid) {
        setError(emailValidation.error || 'Invalid email');
        return;
      }

      const usernameValidation = validateUsername(username);
      if (!usernameValidation.isValid) {
        setError(usernameValidation.error || 'Invalid username');
        return;
      }

      if (!passwordStrength.isValid) {
        setError('Please choose a stronger password');
        return;
      }

      setIsLoading(true);
      try {
        await signUp(email, password, username);
        setSuccess('Account creato! Ora puoi accedere con le tue credenziali.');
        setMode('login');
        setPassword('');
        setUsername('');
      } catch (err: any) {
        console.error('Sign up error:', err);
        const errorMessage = err?.message || 'An error occurred during sign up';
        setError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    } else {
      // Login mode
      setIsLoading(true);
      try {
        const user = await login(email, password);
        if (user) {
          onLogin(user);
        } else {
          setError(
            'Login failed. Please check the browser console (F12) for details. ' +
            'Common issues: profile not created, email not verified, or incorrect credentials.'
          );
        }
      } catch (err) {
        console.error('Login error:', err);
        setError('An error occurred during login. Check console for details.');
      } finally {
        setIsLoading(false);
      }
    }
  };

  // Signup richiede password robusta ed email/username validi.
  const submitDisabled =
    isLoading ||
    (mode === 'signup' && (!passwordStrength.isValid || !!emailError || !!usernameError));

  return (
    <div className="login-page">
      <div className="login-container">
        {/* Status Indicator */}
        <div style={{
          marginBottom: '16px',
          padding: '8px 12px',
          backgroundColor: homeserverEnabled ? '#E8F5E9' : '#FFF3E0',
          borderRadius: '8px',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: homeserverEnabled ? '#2E7D32' : '#E65100'
        }}>
          {homeserverEnabled ? '🟢 Server connesso' : '🔴 Modalità offline'}
        </div>

        <h1 className="login-title">
          {mode === 'login' ? 'Accedi'
            : mode === 'signup' ? 'Crea account'
            : 'Recupera password'}
        </h1>

        <form onSubmit={handleSubmit} className="login-form">
          {/* Username field - only for signup */}
          {mode === 'signup' && (
            <div className="form-field">
              <label style={{
                display: 'block',
                marginBottom: '4px',
                fontSize: '0.875rem',
                color: 'var(--color-text-secondary)'
              }}>
                Username *
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="nome_utente"
                className="login-input"
                required
                disabled={isLoading}
                style={{
                  borderColor: usernameError ? '#f44336' : undefined
                }}
              />
              {usernameError && (
                <div style={{
                  color: '#f44336',
                  fontSize: '0.75rem',
                  marginTop: '4px'
                }}>
                  {usernameError}
                </div>
              )}
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--color-text-secondary)',
                marginTop: '4px'
              }}>
                3-20 caratteri: lettere, numeri e underscore
              </div>
            </div>
          )}

          {/* Email field */}
          <div className="form-field">
            <label style={{
              display: 'block',
              marginBottom: '4px',
              fontSize: '0.875rem',
              color: 'var(--color-text-secondary)'
            }}>
              Email *
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nome@opifiresafe.com"
              className="login-input"
              required
              autoComplete="email"
              disabled={isLoading}
              style={{
                borderColor: emailError ? '#f44336' : undefined
              }}
            />
            {emailError && (
              <div style={{
                color: '#f44336',
                fontSize: '0.75rem',
                marginTop: '4px'
              }}>
                {emailError}
              </div>
            )}
            {(mode === 'signup' || mode === 'forgot') && (
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--color-text-secondary)',
                marginTop: '4px'
              }}>
                Solo email @opifiresafe.com
              </div>
            )}
          </div>

          {/* Password field - not for forgot password */}
          {mode !== 'forgot' && (
            <div className="form-field">
              <label style={{
                display: 'block',
                marginBottom: '4px',
                fontSize: '0.875rem',
                color: 'var(--color-text-secondary)'
              }}>
                Password *
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'Password robusta' : 'Password'}
                  className="login-input"
                  required
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  disabled={isLoading}
                  minLength={mode === 'signup' ? 8 : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px',
                    fontSize: '0.875rem',
                    color: 'var(--color-text-secondary)'
                  }}
                  disabled={isLoading}
                >
                  {showPassword ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>

              {/* Password strength indicator - only for signup */}
              {mode === 'signup' && password && (
                <div style={{ marginTop: '8px' }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '4px'
                  }}>
                    <span style={{
                      fontSize: '0.75rem',
                      color: getPasswordStrengthColor(passwordStrength.score),
                      fontWeight: 'bold'
                    }}>
                      {getPasswordStrengthLabel(passwordStrength.score)}
                    </span>
                    <span style={{
                      fontSize: '0.75rem',
                      color: 'var(--color-text-secondary)'
                    }}>
                      {passwordStrength.score}/4
                    </span>
                  </div>
                  <div style={{
                    height: '4px',
                    backgroundColor: '#e0e0e0',
                    borderRadius: '2px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${(passwordStrength.score / 4) * 100}%`,
                      backgroundColor: getPasswordStrengthColor(passwordStrength.score),
                      transition: 'width 0.3s ease, background-color 0.3s ease'
                    }} />
                  </div>
                  {passwordStrength.feedback.length > 0 && (
                    <ul style={{
                      fontSize: '0.75rem',
                      color: '#f44336',
                      margin: '8px 0 0 0',
                      paddingLeft: '20px'
                    }}>
                      {passwordStrength.feedback.map((feedback, idx) => (
                        <li key={idx}>{feedback}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="error-message" style={{
              color: '#C97A7A',
              textAlign: 'center',
              marginTop: '8px',
              fontSize: '0.875rem',
              padding: '8px',
              backgroundColor: '#FFEBEE',
              borderRadius: '4px'
            }}>
              {error}
            </div>
          )}

          {/* Success message */}
          {success && (
            <div style={{
              color: '#4CAF50',
              textAlign: 'center',
              marginTop: '8px',
              fontSize: '0.875rem',
              padding: '8px',
              backgroundColor: '#E8F5E9',
              borderRadius: '4px'
            }}>
              {success}
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            className="login-button"
            disabled={submitDisabled}
            style={{
              opacity: submitDisabled ? 0.6 : 1,
              cursor: submitDisabled ? 'not-allowed' : 'pointer'
            }}
          >
            {isLoading
              ? mode === 'login' ? 'Accesso...' : mode === 'signup' ? 'Creazione account...' : 'Invio link...'
              : mode === 'login' ? 'Accedi' : mode === 'signup' ? 'Crea account' : 'Invia link di reset'
            }
          </button>

          {/* Forgot password link - only in login mode */}
          {mode === 'login' && (
            <button
              type="button"
              className="reset-link"
              onClick={() => {
                setMode('forgot');
                setError('');
                setSuccess('');
              }}
              disabled={isLoading}
              style={{
                marginTop: '8px',
                background: 'none',
                border: 'none',
                color: 'var(--color-primary)',
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: '0.875rem',
                padding: '4px'
              }}
            >
              Password dimenticata?
            </button>
          )}

          {/* Mode toggle */}
          {(
            <div style={{
              marginTop: '16px',
              textAlign: 'center',
              fontSize: '0.875rem'
            }}>
              <button
                type="button"
                onClick={() => {
                  if (mode === 'forgot') {
                    setMode('login');
                  } else {
                    setMode(mode === 'login' ? 'signup' : 'login');
                  }
                  setError('');
                  setSuccess('');
                  setPassword('');
                  setUsername('');
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
                {mode === 'forgot'
                  ? 'Torna al login'
                  : mode === 'login'
                  ? 'Non hai un account? Registrati'
                  : 'Hai già un account? Accedi'
                }
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default Login;
