/**
 * Theme Configuration - Design System
 * Centralized colors, sizes, and styling constants
 */

export const COLORS = {
  // Status Colors
  bullish: {
    light: '#10b981',
    dark: '#059669',
    bg: 'bg-green-500',
    text: 'text-green-500',
    border: 'border-green-500',
  },
  bearish: {
    light: '#ef4444',
    dark: '#dc2626',
    bg: 'bg-red-500',
    text: 'text-red-500',
    border: 'border-red-500',
  },
  neutral: {
    light: '#6b7280',
    dark: '#4b5563',
    bg: 'bg-gray-500',
    text: 'text-gray-500',
    border: 'border-gray-500',
  },
  
  // Theme Colors
  primary: {
    light: '#06b6d4',
    dark: '#0891b2',
    bg: 'bg-cyan-500',
    text: 'text-cyan-500',
    border: 'border-cyan-500',
  },
  secondary: {
    light: '#14b8a6',
    dark: '#0d9488',
    bg: 'bg-teal-500',
    text: 'text-teal-500',
    border: 'border-teal-500',
  },
  
  // UI Colors
  success: {
    light: '#10b981',
    dark: '#059669',
    bg: 'bg-emerald-500',
    text: 'text-emerald-500',
    border: 'border-emerald-500',
  },
  warning: {
    light: '#f59e0b',
    dark: '#d97706',
    bg: 'bg-amber-500',
    text: 'text-amber-500',
    border: 'border-amber-500',
  },
  error: {
    light: '#ef4444',
    dark: '#dc2626',
    bg: 'bg-red-500',
    text: 'text-red-500',
    border: 'border-red-500',
  },
} as const;

export const BORDERS = {
  light: 'border-green-500/30',
  medium: 'border-green-500/40',
  strong: 'border-green-500/60',
  emerald: 'border-emerald-500/30',
  
  // Sizes
  thin: 'border',
  normal: 'border-2',
  thick: 'border-4',
} as const;

export const SHADOWS = {
  light: 'shadow-sm shadow-green-500/10',
  medium: 'shadow-md shadow-green-500/20',
  strong: 'shadow-lg shadow-green-500/30',
  emerald: 'shadow-lg shadow-emerald-500/20',
} as const;

export const BACKGROUNDS = {
  card: 'bg-gradient-to-br from-gray-950 via-gray-900 to-black',
  surface: 'bg-black/20',
  overlay: 'bg-black/40',
  emerald: 'bg-emerald-950/20',
  green: 'bg-green-950/10',
} as const;

export const SPACING = {
  section: 'mb-6',
  card: 'p-6',
  compact: 'p-3',
  tight: 'gap-2',
  normal: 'gap-4',
  wide: 'gap-6',
} as const;

export const TYPOGRAPHY = {
  title: {
    large: 'text-2xl font-bold',
    medium: 'text-xl font-bold',
    small: 'text-lg font-bold',
  },
  heading: {
    large: 'text-lg font-semibold',
    medium: 'text-base font-semibold',
    small: 'text-sm font-semibold',
  },
  body: {
    large: 'text-base',
    medium: 'text-sm',
    small: 'text-xs',
  },
  mono: 'font-mono font-bold',
} as const;

export const ANIMATIONS = {
  pulse: 'animate-pulse',
  spin: 'animate-spin',
  transition: 'transition-all duration-300',
  hover: 'hover:scale-[1.01]',
} as const;
