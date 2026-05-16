export type TradeSymbol = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';

export type TradeStatusTheme = 'terminal-dark' | 'terminal-light';

export type TradeStatusZone =
  | 'core'
  | 'signals'
  | 'global'
  | 'risk'
  | 'execution'
  | 'intel';

export type TradeStatusHealth = 'healthy' | 'degraded' | 'offline';

export interface TradeStatusRuntimeContext {
  symbol: TradeSymbol;
  theme: TradeStatusTheme;
  searchQuery: string;
  refreshIntervalMs: number;
}

export interface TradeStatusPluginDefinition {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  zone: TradeStatusZone;
  priority: number;
  minHeightPx?: number;
  dense?: boolean;
  supportsSymbols: boolean;
  supportsCollapse: boolean;
  defaultEnabled: boolean;
  health: TradeStatusHealth;
  render: (context: TradeStatusRuntimeContext) => JSX.Element;
}

export interface TradeStatusModuleRuntime {
  id: string;
  enabled: boolean;
  lastRenderAt: number;
  health: TradeStatusHealth;
}

export interface TradeStatusManifestItem {
  id: string;
  title: string;
  zone: TradeStatusZone;
  priority: number;
  supportsSymbols: boolean;
  defaultEnabled: boolean;
}

export interface TradeStatusEngineSymbol {
  symbol: TradeSymbol;
  price: number;
  change_pct: number;
  status: string;
  signal: string;
  confidence: number;
  buy_pressure: number;
  sell_pressure: number;
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | string;
  regime: string;
  regime_score: number;
  pulse_5m: string;
  timestamp: string;
}

export interface TradeStatusEngineAlert {
  id: string;
  level: 'INFO' | 'WARNING' | 'CRITICAL' | string;
  symbol: TradeSymbol;
  title: string;
  message: string;
  timestamp: string;
}

export interface TradeStatusEngineResponse {
  engine: string;
  version: string;
  generated_at: string;
  meta: {
    active_symbol: TradeSymbol;
    market_phase: string;
    connected_symbols: TradeSymbol[];
    refresh_interval_ms: number;
    latency_budget_ms: number;
  };
  global: {
    vix: {
      value: number;
      change_pct: number;
      volatility_level: string;
      fear_score: number;
    };
    breadth: {
      bullish_count: number;
      bearish_count: number;
      neutral_count: number;
      total: number;
      avg_confidence: number;
    };
  };
  symbols: Record<TradeSymbol, TradeStatusEngineSymbol>;
  alerts: TradeStatusEngineAlert[];
  modules: TradeStatusManifestItem[];
}
