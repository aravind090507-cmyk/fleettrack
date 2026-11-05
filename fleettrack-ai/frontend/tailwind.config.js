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
        slate: {
          750: '#243044',
          850: '#151f32',
          950: '#0b1120',
        },
      },
    },
  },
  plugins: [],
}
