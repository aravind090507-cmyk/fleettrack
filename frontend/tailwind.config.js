/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        fleet: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          dark: '#0f172a',
          darker: '#020617',
          surface: '#1e293b',
          card: '#334155',
          border: '#475569'
        }
      }
    },
  },
  plugins: [],
}
