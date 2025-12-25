/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Dark theme colors - improved contrast
        'dark': {
          'bg': '#0d0d12',
          'card': '#13131a',
          'border': '#2a2a38',
          'text': '#e8e8ef',
          'muted': '#8888a0',
          'surface': '#1a1a24',
        },
        // Trading colors - vibrant
        'bullish': '#22c55e',
        'bearish': '#ef4444',
        'neutral': '#eab308',
        'accent': '#6366f1',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'flash-green': 'flashGreen 0.4s ease-out',
        'flash-red': 'flashRed 0.4s ease-out',
      },
      keyframes: {
        flashGreen: {
          '0%': { backgroundColor: 'rgba(34, 197, 94, 0.15)' },
          '100%': { backgroundColor: 'transparent' },
        },
        flashRed: {
          '0%': { backgroundColor: 'rgba(239, 68, 68, 0.15)' },
          '100%': { backgroundColor: 'transparent' },
        },
      },
      screens: {
        'xs': '375px',
        '3xl': '1920px',
      },
      fontSize: {
        'xxs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      backdropBlur: {
        'xs': '2px',
      },
    },
  },
  plugins: [],
}
