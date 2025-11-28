import React, { useState, useEffect } from 'react';
import { updatePassword } from '../db';
import {
  validatePasswordStrength,
  getPasswordStrengthLabel,
  getPasswordStrengthColor
} from '../utils/validation';
import './Login.css';

interface PasswordResetProps {
  onSuccess: () => void;
}

const PasswordReset: React.FC<PasswordResetProps> = ({ onSuccess }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [passwordStrength, setPasswordStrength] = useState({
    isValid: false,
    score: 0,
    feedback: [] as string[]
  });

  // Validate password on change
  useEffect(() => {
    if (password) {
      const strength = validatePasswordStrength(password);
      setPasswordStrength(strength);
    } else {
      setPasswordStrength({ isValid: false, score: 0, feedback: [] });
    }
  }, [password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validate password strength
    if (!passwordStrength.isValid) {
      setError('Please choose a stronger password');
      return;
    }

    // Check passwords match
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    try {
      const result = await updatePassword(password);

      if (result.success) {
        setSuccess('Password updated successfully! Redirecting to login...');
        setTimeout(() => {
          onSuccess();
        }, 2000);
      } else {
        setError(result.error || 'Failed to update password');
      }
    } catch (err) {
      console.error('Password reset error:', err);
      setError('An error occurred while updating your password');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div style={{
          marginBottom: '16px',
          padding: '8px 12px',
          backgroundColor: '#E3F2FD',
          borderRadius: '8px',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: '#1976D2'
        }}>
          🔐 Reset Your Password
        </div>

        <h1 className="login-title">Create New Password</h1>

        <form onSubmit={handleSubmit} className="login-form">
          {/* New Password */}
          <div className="form-field">
            <label style={{
              display: 'block',
              marginBottom: '4px',
              fontSize: '0.875rem',
              color: 'var(--color-text-secondary)'
            }}>
              New Password *
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter strong password"
                className="login-input"
                required
                autoComplete="new-password"
                disabled={isLoading}
                minLength={8}
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

            {/* Password strength indicator */}
            {password && (
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

          {/* Confirm Password */}
          <div className="form-field">
            <label style={{
              display: 'block',
              marginBottom: '4px',
              fontSize: '0.875rem',
              color: 'var(--color-text-secondary)'
            }}>
              Confirm Password *
            </label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              className="login-input"
              required
              autoComplete="new-password"
              disabled={isLoading}
              style={{
                borderColor: confirmPassword && password !== confirmPassword ? '#f44336' : undefined
              }}
            />
            {confirmPassword && password !== confirmPassword && (
              <div style={{
                color: '#f44336',
                fontSize: '0.75rem',
                marginTop: '4px'
              }}>
                Passwords do not match
              </div>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div style={{
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
            disabled={isLoading || !passwordStrength.isValid || password !== confirmPassword}
            style={{
              opacity: isLoading || !passwordStrength.isValid || password !== confirmPassword ? 0.6 : 1,
              cursor: isLoading || !passwordStrength.isValid || password !== confirmPassword ? 'not-allowed' : 'pointer'
            }}
          >
            {isLoading ? 'Updating password...' : 'Reset Password'}
          </button>

          <div style={{
            marginTop: '16px',
            textAlign: 'center',
            fontSize: '0.75rem',
            color: 'var(--color-text-secondary)'
          }}>
            Password must be at least 8 characters with uppercase, lowercase, numbers, and special characters
          </div>
        </form>
      </div>
    </div>
  );
};

export default PasswordReset;
