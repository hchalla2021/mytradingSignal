'use client';

import { useMemo, useState } from 'react';
import ModuleCard from '@/components/trade-status/ModuleCard';
import type {
  TradeStatusPluginDefinition,
  TradeStatusRuntimeContext,
  TradeStatusTheme,
  TradeSymbol,
} from '@/types/trade-status';

interface TradeStatusEngineProps {
  plugins: TradeStatusPluginDefinition[];
  symbol: TradeSymbol;
  theme: TradeStatusTheme;
  refreshIntervalMs?: number;
}

const ZONES = ['all', 'core', 'signals', 'global', 'risk', 'execution', 'intel'] as const;
type ZoneFilter = (typeof ZONES)[number];

export default function TradeStatusEngine({
  plugins,
  symbol,
  theme,
  refreshIntervalMs = 2500,
}: TradeStatusEngineProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [zoneFilter, setZoneFilter] = useState<ZoneFilter>('all');

  const sorted = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return plugins
      .filter((plugin) => plugin.defaultEnabled)
      .filter((plugin) => (zoneFilter === 'all' ? true : plugin.zone === zoneFilter))
      .filter((plugin) => {
        if (!normalized) return true;
        const bucket = `${plugin.title} ${plugin.subtitle} ${plugin.description}`.toLowerCase();
        return bucket.includes(normalized);
      })
      .sort((left, right) => left.priority - right.priority);
  }, [plugins, query, zoneFilter]);

  const context: TradeStatusRuntimeContext = useMemo(
    () => ({
      symbol,
      theme,
      searchQuery: query,
      refreshIntervalMs,
    }),
    [symbol, theme, query, refreshIntervalMs]
  );

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {ZONES.map((zone) => (
              <button
                key={zone}
                type="button"
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                  zoneFilter === zone
                    ? 'border-cyan-400/70 bg-cyan-500/20 text-cyan-200'
                    : 'border-slate-600/70 bg-slate-800/60 text-slate-300 hover:border-slate-500'
                }`}
                onClick={() => setZoneFilter(zone)}
              >
                {zone}
              </button>
            ))}
          </div>

          <label className="flex min-w-[220px] items-center gap-2 rounded-lg border border-slate-600/70 bg-slate-800/60 px-3 py-2">
            <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Module, signal, risk..."
              className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
              aria-label="Search trade status modules"
            />
          </label>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {sorted.map((plugin) => {
          const spanClass = plugin.dense ? 'xl:col-span-6' : 'xl:col-span-12';
          return (
            <div key={plugin.id} className={spanClass}>
              <ModuleCard plugin={plugin} context={context} theme={theme} />
            </div>
          );
        })}
      </section>
    </div>
  );
}
