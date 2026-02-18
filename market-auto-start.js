/**
 * CENTRALIZED MARKET AUTO-START SYSTEM
 * ====================================
 * Automatically starts backend at 9 AM on trading days
 * Monitors health and restarts if crashed
 * 
 * Usage on DigitalOcean:
 * 1. pm2 start market-auto-start.js --name "market-scheduler"
 * 2. pm2 save
 * 3. pm2 startup
 * 
 * This will:
 * - Start automatically on server reboot
 * - Monitor backend health 24/7
 * - Auto-restart backend if it crashes
 * - Log all actions for debugging
 */

const cron = require('node-cron');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============= CONFIGURATION =============
const CONFIG = {
  PROJECT_PATH: '/var/www/mytradingSignal',
  BACKEND_NAME: 'backend',
  FRONTEND_NAME: 'frontend',
  
  // Trading hours (IST - India Standard Time)
  MARKET_OPEN_HOUR: 9,
  MARKET_OPEN_MINUTE: 0,
  MARKET_CLOSE_HOUR: 15,
  MARKET_CLOSE_MINUTE: 30,
  
  // Pre-open period: 9:00 - 9:15 (values frozen)
  PREOPEN_START: 9,
  PREOPEN_END_MINUTE: 15,
  
  // Live values start: 9:15 AM
  LIVE_START_HOUR: 9,
  LIVE_START_MINUTE: 15,
  
  LOG_FILE: '/var/log/mytradingSignal/market-scheduler.log',
  ERROR_LOG: '/var/log/mytradingSignal/market-scheduler-error.log',
};

// ============= MARKET HOLIDAYS (NSE/BSE) =============
// https://www.nseindia.com/market-data/holiday-calendar
const MARKET_HOLIDAYS_2026 = [
  '2026-01-26', // Republic Day
  '2026-03-25', // Holi
  '2026-04-02', // Good Friday
  '2026-05-01', // Labour Day
  '2026-07-17', // Eid-ul-Adha
  '2026-08-15', // Independence Day
  '2026-09-02', // Janmastami
  '2026-10-02', // Gandhi Jayanti
  '2026-10-25', // Dussehra
  '2026-11-01', // Diwali (Sunday)
  '2026-11-11', // Diwali Holidays
  '2026-12-25', // Christmas
];

// Update these before market opens for next year or as needed
const MARKET_HOLIDAYS_2027 = [
  '2027-01-26', // Republic Day
  '2027-03-14', // Holi
  '2027-04-02', // Good Friday
  '2027-05-01', // Labour Day
  '2027-07-06', // Eid-ul-Adha
  '2027-08-15', // Independence Day
  '2027-08-19', // Janmastami
  '2027-10-02', // Gandhi Jayanti
  '2027-10-16', // Dussehra
  '2027-10-20', // Diwali
  '2027-10-21', // Diwali Holidays
  '2027-12-25', // Christmas
];

// ============= LOGGER =============
class Logger {
  constructor(logFile, errorFile) {
    this.logFile = logFile;
    this.errorFile = errorFile;
    this.ensureLogDir();
  }

  ensureLogDir() {
    const dir = path.dirname(this.logFile);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (e) {
        console.error('Failed to create log directory:', e);
      }
    }
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log(logMessage);
    try {
      fs.appendFileSync(this.logFile, logMessage);
    } catch (e) {
      console.error('Failed to write log:', e);
    }
  }

  error(message, err = null) {
    const timestamp = new Date().toISOString();
    const errorMessage = `[${timestamp}] ERROR: ${message}${err ? '\n' + err.toString() : ''}\n`;
    console.error(errorMessage);
    try {
      fs.appendFileSync(this.errorFile, errorMessage);
    } catch (e) {
      console.error('Failed to write error log:', e);
    }
  }
}

const logger = new Logger(CONFIG.LOG_FILE, CONFIG.ERROR_LOG);

// ============= HELPER FUNCTIONS =============

/**
 * Check if today is a trading day
 * Trading days: Monday-Friday, excluding holidays and weekends
 */
function isMarketOpen() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday
  
  // Skip weekends
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }

  // Check holidays
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const allHolidays = [...MARKET_HOLIDAYS_2026, ...MARKET_HOLIDAYS_2027];
  
  if (allHolidays.includes(dateStr)) {
    logger.log(`📅 Today is a market holiday: ${dateStr}`);
    return false;
  }

  return true;
}

/**
 * Get current time in IST (UTC+5:30)
 */
function getCurrentTimeIST() {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return istTime;
}

/**
 * Check if current time is within market hours
 */
function isWithinMarketHours() {
  const istTime = getCurrentTimeIST();
  const hour = istTime.getHours();
  const minute = istTime.getMinutes();
  
  const currentTimeInMinutes = hour * 60 + minute;
  const marketOpenTime = CONFIG.MARKET_OPEN_HOUR * 60 + CONFIG.MARKET_OPEN_MINUTE;
  const marketCloseTime = CONFIG.MARKET_CLOSE_HOUR * 60 + CONFIG.MARKET_CLOSE_MINUTE;
  
  return currentTimeInMinutes >= marketOpenTime && currentTimeInMinutes <= marketCloseTime;
}

/**
 * Check if we're in pre-open period (9:00 - 9:15)
 */
function isPreOpenPeriod() {
  const istTime = getCurrentTimeIST();
  const hour = istTime.getHours();
  const minute = istTime.getMinutes();
  
  return hour === CONFIG.PREOPEN_START && minute < CONFIG.PREOPEN_END_MINUTE;
}

/**
 * Check if backend is running via PM2
 */
function isBackendRunning() {
  try {
    const output = execSync('pm2 list --silent', { encoding: 'utf-8' });
    return output.includes(CONFIG.BACKEND_NAME) && output.includes('online');
  } catch (e) {
    logger.error('Failed to check PM2 list', e);
    return false;
  }
}

/**
 * Start backend using PM2
 */
function startBackend() {
  try {
    logger.log('🚀 Starting backend...');
    // Change to project directory and start backend
    execSync(`cd ${CONFIG.PROJECT_PATH} && pm2 start backend/main.py --name ${CONFIG.BACKEND_NAME} --interpreter python3`, {
      stdio: 'inherit'
    });
    logger.log('✅ Backend started successfully');
    return true;
  } catch (e) {
    logger.error('Failed to start backend', e);
    return false;
  }
}

/**
 * Restart backend using PM2
 */
function restartBackend() {
  try {
    logger.log('🔄 Restarting backend...');
    execSync(`pm2 restart ${CONFIG.BACKEND_NAME}`, { stdio: 'inherit' });
    logger.log('✅ Backend restarted successfully');
    return true;
  } catch (e) {
    logger.error('Failed to restart backend', e);
    return false;
  }
}

/**
 * Health check - HTTP ping to backend
 */
async function healthCheckBackend() {
  try {
    const http = require('http');
    return new Promise((resolve) => {
      const req = http.get('http://localhost:8000/health', (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(3000, () => {
        req.destroy();
        resolve(false);
      });
    });
  } catch (e) {
    return false;
  }
}

// ============= MAIN SCHEDULER LOGIC =============

async function checkAndStartBackend() {
  const istTime = getCurrentTimeIST();
  const timeStr = istTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  
  console.log(`\n🕐 Market Scheduler Check - ${timeStr}`);
  
  // Check if it's a market day
  if (!isMarketOpen()) {
    console.log('📊 Market closed (weekend or holiday)');
    return;
  }

  // Check if within market hours
  if (!isWithinMarketHours()) {
    console.log('⏰ Outside market hours');
    return;
  }

  logger.log(`=== MARKET DAY & TRADING HOURS ===`);
  logger.log(`🕐 Current Time (IST): ${timeStr}`);

  // Check if in pre-open period
  if (isPreOpenPeriod()) {
    logger.log('📻 PRE-OPEN PERIOD (9:00-9:15): Values frozen, no live feed');
  } else {
    logger.log(`📈 LIVE TRADING PERIOD (9:15-3:30): Live values streaming`);
  }

  // Check if backend is running
  const backendRunning = isBackendRunning();
  
  if (!backendRunning) {
    logger.log('🔴 Backend is DOWN - Starting now...');
    
    // Try to start backend
    const started = startBackend();
    
    if (started) {
      logger.log('⏳ Waiting 5 seconds for backend to initialize...');
      await new Promise(r => setTimeout(r, 5000));
      
      // Health check
      const healthy = await healthCheckBackend();
      if (healthy) {
        logger.log('✅ Health check PASSED - Backend is responsive');
      } else {
        logger.log('⚠️  Health check FAILED - Backend started but not responsive yet');
      }
    }
  } else {
    logger.log('✅ Backend is already running');
    
    // Periodic health check even if running
    const healthy = await healthCheckBackend();
    if (!healthy) {
      logger.log('⚠️  Backend not responding - attempting restart...');
      restartBackend();
    }
  }
}

// ============= CRON JOBS =============

function setupSchedules() {
  // Job 1: Check every minute if we should start backend
  cron.schedule('* * * * *', checkAndStartBackend, {
    timezone: 'Asia/Kolkata' // IST timezone
  });
  logger.log('📅 Cron Job 1: Minute-level monitoring (every 60 seconds)');

  // Job 2: At exactly 9:00 AM IST - Force start backend
  cron.schedule('0 9 * * 1-5', async () => {
    logger.log('\n⏰ 9:00 AM Market Open Event Triggered');
    logger.log('🟠 PRE-OPEN PERIOD STARTING (9:00-9:15)');
    logger.log('📊 Values will be frozen, no live feed yet');
    logger.log('Attempting to start backend for pre-open...');
    await checkAndStartBackend();
  }, {
    timezone: 'Asia/Kolkata'
  });
  logger.log('📅 Cron Job 2: 9:00 AM Daily Trigger (Mon-Fri)');

  // Job 3: At 9:15 AM IST - Live trading starts
  cron.schedule('15 9 * * 1-5', () => {
    logger.log('\n⏰ 9:15 AM - Live Trading Started');
    logger.log('🟢 LIVE TRADING PERIOD (9:15-3:30)');
    logger.log('📈 Live market values streaming from WebSocket');
  }, {
    timezone: 'Asia/Kolkata'
  });
  logger.log('📅 Cron Job 3: 9:15 AM Daily Alert (Mon-Fri)');

  // Job 4: At 3:30 PM IST - Market close
  cron.schedule('30 15 * * 1-5', () => {
    logger.log('\n⏰ 3:30 PM - Market Closed');
    logger.log('🔴 MARKET CLOSED');
    logger.log('📉 Live feed will stop, values will freeze');
  }, {
    timezone: 'Asia/Kolkata'
  });
  logger.log('📅 Cron Job 4: 3:30 PM Daily Alert (Mon-Fri)');

  // Job 5: Health check every 10 minutes during market hours
  cron.schedule('*/10 9-15 * * 1-5', async () => {
    if (isWithinMarketHours()) {
      const backendRunning = isBackendRunning();
      if (!backendRunning) {
        logger.log('⚠️  Backend crashed during market hours - Restarting...');
        await checkAndStartBackend();
      }
    }
  }, {
    timezone: 'Asia/Kolkata'
  });
  logger.log('📅 Cron Job 5: Health Check Every 10 Minutes (Market Hours)');
}

// ============= STARTUP =============

logger.log('\n' + '='.repeat(60));
logger.log('🚀 MARKET AUTO-START SYSTEM INITIALIZED');
logger.log('='.repeat(60));
logger.log(`Project Path: ${CONFIG.PROJECT_PATH}`);
logger.log(`Market Open: 9:00 AM IST`);
logger.log(`Pre-Open Period: 9:00 - 9:15 (Values Frozen)`);
logger.log(`Live Trading: 9:15 AM - 3:30 PM (Live Feed)`);
logger.log(`Market Days: Monday - Friday (excluding holidays)`);
logger.log(`Backend Name: ${CONFIG.BACKEND_NAME}`);
logger.log(`Log File: ${CONFIG.LOG_FILE}`);
logger.log('='.repeat(60) + '\n');

// Setup all cron jobs
setupSchedules();

// Initial check
checkAndStartBackend();

// Graceful shutdown
process.on('SIGINT', () => {
  logger.log('\n👋 Scheduler shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.log('\n👋 Scheduler received termination signal...');
  process.exit(0);
});

logger.log('✅ All cron jobs scheduled successfully');
logger.log('💚 System is monitoring for market open time...');
