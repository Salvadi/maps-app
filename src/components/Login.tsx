import React, { useState } from 'react';
import './Login.css';

interface LoginProps {
  onLogin: (username: string, password: string) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username && password) {
      onLogin(username, password);
    }
  };

  const handleResetPassword = () => {
    alert('Password reset functionality would be implemented here');
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <h1 className="login-title">Login</h1>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-field">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              className="login-input"
              required
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
            />
          </div>

          <button type="submit" className="login-button">
            Accedi
          </button>

          <button
            type="button"
            className="reset-link"
            onClick={handleResetPassword}
          >
            Reset password
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
