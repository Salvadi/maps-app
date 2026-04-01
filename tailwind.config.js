/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fdf8f0',
          100: '#f5f0e8',
          200: '#e5dfd5',
          300: '#d4cdc0',
          400: '#b8b0a2',
          500: '#9c9385',
          600: '#6b6b6b',
          700: '#3a3a3a',
          800: '#2a2a2a',
          900: '#1a1a1a',
        },
        accent: {
          DEFAULT: '#007AFF',
          light: '#4DA2FF',
          dark: '#0056B3',
        },
        success: '#34C759',
        warning: '#FF9500',
        danger: '#FF3B30',
      },
      borderRadius: {
        'xl': '16px',
        '2xl': '20px',
      },
      boxShadow: {
        'card': '0 2px 8px rgba(0, 0, 0, 0.08)',
        'card-hover': '0 4px 16px rgba(0, 0, 0, 0.12)',
        'nav': '0 -1px 12px rgba(0, 0, 0, 0.08)',
      },
      spacing: {
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
      },
    },
  },
  plugins: [],
}
