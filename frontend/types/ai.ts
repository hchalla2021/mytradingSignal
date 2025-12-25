/**
 * AI Analysis Types
 * Smart alerts and market intelligence
 */

export type AlertLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';

export interface AIAlert {
  level: AlertLevel;
  message: string;
  show_popup: boolean;
  timestamp?: string;
}

export interface AISignal {
  strength: number; // 0-100
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number; // 0-100
}

export interface AIAnalysis {
  symbol: string;
  market_state: string;
  bullish_probability: number;
  bearish_probability: number;
  next_move: string;
  confidence: number;
  alerts: AIAlert[];
  signal: AISignal;
  risk_level: string;
  action: {
    trade: boolean;
    recommendation: string;
    reason: string;
  };
  timestamp: string;
}

export interface AIAlertTooltipData {
  showAlert: boolean;
  level: AlertLevel;
  message: string;
  signalStrength?: number;
}
