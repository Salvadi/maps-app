/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Minimalist neutral palette
        background: '#F5F5F5',
        card: '#FFFFFF',
        'text-primary': '#2C2C2C',
        'text-secondary': '#6B6B6B',
        border: '#E0E0E0',
        accent: '#7A9CC6',
        success: '#7FB069',
        error: '#C97A7A',
        warning: '#E8B17A',
      },
      borderRadius: {
        'sm': '8px',
        'md': '12px',
        'lg': '16px',
      },
      boxShadow: {
        'soft': '0 2px 8px rgba(0, 0, 0, 0.06)',
        'soft-hover': '0 4px 12px rgba(0, 0, 0, 0.08)',
        'button': '0 2px 4px rgba(0, 0, 0, 0.08)',
      },
    },
  },
  plugins: [],
}
