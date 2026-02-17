import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '24px',
          backgroundColor: 'var(--color-bg-primary, #f5f0e8)',
          textAlign: 'center',
        }}>
          <h2 style={{
            color: 'var(--color-text-primary, #3a3a3a)',
            marginBottom: '12px',
            fontSize: '1.25rem',
          }}>
            Si è verificato un errore
          </h2>
          <p style={{
            color: 'var(--color-text-secondary, #6b6b6b)',
            marginBottom: '24px',
            maxWidth: '400px',
          }}>
            Qualcosa è andato storto. Puoi provare a ripristinare la pagina o ricaricarla completamente.
          </p>
          {this.state.error && (
            <pre style={{
              background: 'var(--color-bg-secondary, #fff)',
              padding: '12px',
              borderRadius: '8px',
              fontSize: '0.75rem',
              color: '#c0392b',
              maxWidth: '500px',
              overflow: 'auto',
              marginBottom: '24px',
              border: '1px solid var(--color-border, #e5dfd5)',
            }}>
              {this.state.error.message}
            </pre>
          )}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={this.handleRetry}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: 'var(--color-accent, #b8860b)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              Riprova
            </button>
            <button
              onClick={this.handleReload}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                border: '1px solid var(--color-border, #e5dfd5)',
                backgroundColor: 'var(--color-bg-secondary, #fff)',
                color: 'var(--color-text-primary, #3a3a3a)',
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              Ricarica pagina
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
