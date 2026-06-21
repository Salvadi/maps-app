/** @type {import('tailwindcss').Config} */

// Helper: colore theme-aware da CSS variable (tripletta RGB) con supporto alpha
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Scala neutra theme-aware (ex beige). I componenti esistenti che usano
        // brand-* diventano automaticamente compatibili col tema scuro.
        brand: {
          50: v('--n-50'),
          100: v('--n-100'),
          200: v('--n-200'),
          300: v('--n-300'),
          400: v('--n-400'),
          500: v('--n-500'),
          600: v('--n-600'),
          700: v('--n-700'),
          800: v('--n-800'),
          900: v('--n-900'),
        },
        // Blu interattivo (ex iOS blue)
        accent: {
          DEFAULT: v('--c-action'),
          light: v('--c-action-strong'),
          dark: v('--c-action-strong'),
          soft: v('--c-action-soft'),
        },
        // Token semantici nuovi
        surface: {
          DEFAULT: v('--c-surface'),
          2: v('--c-surface-2'),
          3: v('--c-surface-3'),
        },
        page: v('--c-bg'),
        ink: {
          DEFAULT: v('--c-ink'),
          2: v('--c-ink-2'),
          3: v('--c-ink-3'),
        },
        line: {
          DEFAULT: v('--c-line'),
          strong: v('--c-line-strong'),
        },
        navy: {
          DEFAULT: v('--c-navy'),
          deep: v('--c-navy-deep'),
        },
        flame: {
          DEFAULT: v('--c-flame'),
          soft: v('--c-flame-soft'),
        },
        success: {
          DEFAULT: v('--c-success'),
          soft: v('--c-success-soft'),
        },
        warning: {
          DEFAULT: v('--c-warning'),
          soft: v('--c-warning-soft'),
        },
        danger: {
          DEFAULT: v('--c-danger'),
          soft: v('--c-danger-soft'),
        },
      },
      borderRadius: {
        'xl': '16px',
        '2xl': '20px',
      },
      boxShadow: {
        'card': 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        'nav': 'var(--shadow-nav)',
        'pop': 'var(--shadow-pop)',
      },
      spacing: {
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
      },
    },
  },
  plugins: [],
}
