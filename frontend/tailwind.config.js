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
        // Professional Trading App Theme
        'dark': {
          'bg': '#0a0e1a',
          'card': '#1a2332',
          'surface': '#0f1421',
          'elevated': '#1f2937',
          'border': '#334155',
          'border-subtle': '#1e293b',
          'text': '#f1f5f9',
          'secondary': '#cbd5e1',
          'tertiary': '#94a3b8',
          'muted': '#64748b',
        },
        // Trading colors - vibrant & professional
        'bullish': {
          DEFAULT: '#10b981',
          light: '#34d399',
          dark: '#059669',
          glow: 'rgba(16, 185, 129, 0.2)',
        },
        'bearish': {
          DEFAULT: '#ef4444',
          light: '#f87171',
          dark: '#dc2626',
          glow: 'rgba(239, 68, 68, 0.2)',
        },
        'neutral': {
          DEFAULT: '#f59e0b',
          light: '#fbbf24',
        },
        'accent': {
          DEFAULT: '#3b82f6',
          secondary: '#8b5cf6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Monaco', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'flash-green': 'flashGreen 0.4s ease-out',
        'flash-red': 'flashRed 0.4s ease-out',
        'fadeIn': 'fadeIn 0.3s ease-in',
        'ping-fast': 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite',
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
        fadeIn: {
          '0%': { opacity: '0.8' },
          '100%': { opacity: '1' },
        },
        ping: {
          '75%, 100%': {
            transform: 'scale(1.05)',
            opacity: '0',
          },
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
