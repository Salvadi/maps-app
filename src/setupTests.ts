// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

/**
 * Polyfill for structuredClone (required by fake-indexeddb)
 */
if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = (val: any) => JSON.parse(JSON.stringify(val));
}

/**
 * Mock IndexedDB for tests
 * The app uses Dexie.js which requires IndexedDB
 */
import 'fake-indexeddb/auto';

/**
 * Mock window.alert for tests
 */
global.alert = jest.fn();

/**
 * Mock window.matchMedia for tests
 */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

/**
 * Suppress console output during tests for cleaner test results
 */
const originalWarn = console.warn;
const originalLog = console.log;
const originalError = console.error;

beforeAll(() => {
  // Suppress expected warnings
  console.warn = (...args: any[]) => {
    if (args[0]?.includes('Supabase credentials not found')) {
      return;
    }
    originalWarn(...args);
  };

  // Suppress informational logs during tests
  console.log = (...args: any[]) => {
    if (
      args[0]?.includes('Database initialized') ||
      args[0]?.includes('App initialized') ||
      args[0]?.includes('offline-only mode')
    ) {
      return;
    }
    originalLog(...args);
  };

  // Suppress expected errors from initialization failures
  console.error = (...args: any[]) => {
    if (
      args[0]?.includes('Failed to initialize') ||
      args[0]?.includes('Not implemented: window.alert')
    ) {
      return;
    }
    originalError(...args);
  };
});

afterAll(() => {
  console.warn = originalWarn;
  console.log = originalLog;
  console.error = originalError;
});
