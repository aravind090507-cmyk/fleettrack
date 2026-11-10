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
          black: '#000000',
          dark: '#0d0d0d',
          darker: '#080808',
          surface: '#151619',
          card: '#1a1b1f',
          border: '#26272b',
          borderLight: '#36373d',
          gold: '#cb886c',
          goldHover: '#d9977c',
          goldLight: '#ebcfbc',
          champagne: '#dac9be',
          linen: '#f7e9e0',
          offwhite: '#f4f5f2',
          muted: '#9c9c9c',
          dim: '#636363',
          error: '#b63b51',
          green: '#45c045',
        },
        fleet: {
          50: '#fef7f3',
          100: '#f7e9e0',
          500: '#cb886c',
          600: '#b8775c',
          700: '#a3644b',
          dark: '#0d0d0d',
          darker: '#000000',
          surface: '#151619',
          card: '#1a1b1f',
          border: '#26272b'
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
