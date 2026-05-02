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
        'flash-green': 'flashGreen 0.7s ease-out forwards',
        'flash-red': 'flashRed 0.7s ease-out forwards',
        'fadeIn': 'fadeIn 0.3s ease-in',
        'ping-fast': 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite',
        'heat-bull': 'heatBull 1.6s ease-in-out infinite',
        'heat-bear': 'heatBear 1.6s ease-in-out infinite',
        'iv-spike': 'ivSpike 0.5s ease-out forwards',
        'scale-pop': 'scalePop 0.7s cubic-bezier(0.25,0.46,0.45,0.94) forwards',
      },
      keyframes: {
        flashGreen: {
          '0%':   { backgroundColor: 'rgba(52, 211, 153, 0.22)' },
          '60%':  { backgroundColor: 'rgba(52, 211, 153, 0.10)' },
          '100%': { backgroundColor: 'transparent' },
        },
        flashRed: {
          '0%':   { backgroundColor: 'rgba(239, 68, 68, 0.22)' },
          '60%':  { backgroundColor: 'rgba(239, 68, 68, 0.10)' },
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
        heatBull: {
          '0%, 100%': { boxShadow: '0 0 6px 1px rgba(52,211,153,0.30)' },
          '50%':      { boxShadow: '0 0 22px 5px rgba(52,211,153,0.65)' },
        },
        heatBear: {
          '0%, 100%': { boxShadow: '0 0 6px 1px rgba(239,68,68,0.30)' },
          '50%':      { boxShadow: '0 0 22px 5px rgba(239,68,68,0.65)' },
        },
        ivSpike: {
          '0%':   { color: 'rgb(253,224,71)', transform: 'scale(1.15)' },
          '100%': { color: 'inherit',         transform: 'scale(1)' },
        },
        scalePop: {
          '0%':   { transform: 'scale(1.35)', opacity: '1' },
          '40%':  { transform: 'scale(1.15)', opacity: '1' },
          '100%': { transform: 'scale(1)',    opacity: '1' },
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
