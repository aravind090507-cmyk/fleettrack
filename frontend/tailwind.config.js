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
        bespoke: {
          black: '#1d1d1f',
          dark: '#f2f2f7',
          darker: '#e5e5ea',
          surface: '#ffffff',
          card: '#ffffff',
          border: 'rgba(0, 0, 0, 0.08)',
          borderLight: 'rgba(0, 0, 0, 0.14)',
          gold: '#0071E3',
          goldHover: '#0077ED',
          goldLight: '#0071E3',
          champagne: '#2c2c2e',
          linen: '#1c1c1e',
          offwhite: '#1d1d1f',
          muted: '#48484a',
          dim: '#636366',
          error: '#ff3b30',
          green: '#34c759',
        },
        fleet: {
          50: '#f2f2f7',
          100: '#e5e5ea',
          500: '#0071E3',
          600: '#0077ED',
          700: '#0056b3',
          dark: '#f2f2f7',
          darker: '#ffffff',
          surface: '#ffffff',
          card: '#ffffff',
          border: 'rgba(0, 0, 0, 0.08)'
        }
      },
      letterSpacing: {
        'widest-plus': '0.12em',
        'bespoke': '0.08em',
      }
    },
  },
  plugins: [],
}
