/**
 * Production-safe logger utility
 * Only logs in development mode
 */

const isDev = process.env.NODE_ENV === 'development';

export const logger = {
  debug: (...args: unknown[]) => {
    if (isDev) console.log(...args);
  },
  info: (...args: unknown[]) => {
    if (isDev) console.info(...args);
  },
  warn: (...args: unknown[]) => {
    console.warn(...args); // Warnings always shown
  },
  error: (...args: unknown[]) => {
    console.error(...args); // Errors always shown
  },
};

export default logger;
