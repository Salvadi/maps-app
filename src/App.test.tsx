import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

describe('OPImaPPA App', () => {
  test('renders login page after initialization', async () => {
    render(<App />);

    // Wait for the app to initialize and show login page
    await waitFor(() => {
      // Look for the login title specifically (using heading role)
      expect(screen.getByRole('heading', { name: /login/i })).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  test('shows offline mode indicator when Supabase not configured', async () => {
    render(<App />);

    // Wait for the app to initialize and show offline mode
    await waitFor(() => {
      const offlineText = screen.getByText(/offline mode/i);
      expect(offlineText).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  test('initializes successfully without errors', async () => {
    const { container } = render(<App />);

    // Wait for initialization to complete
    await waitFor(() => {
      // Should not show "Initializing app..." anymore
      expect(screen.queryByText(/initializing app/i)).not.toBeInTheDocument();
    }, { timeout: 3000 });

    // Should render something (either login or home)
    expect(container.firstChild).toBeInTheDocument();
  });
});
