'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  TradeStatusPluginDefinition,
  TradeStatusRuntimeContext,
  TradeStatusTheme,
} from '@/types/trade-status';

interface ModuleCardProps {
  plugin: TradeStatusPluginDefinition;
  context: TradeStatusRuntimeContext;
  theme: TradeStatusTheme;
}

const HEALTH_TONE: Record<string, string> = {
  healthy: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  degraded: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  offline: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
};

export default function ModuleCard({ plugin, context, theme }: ModuleCardProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [inViewport, setInViewport] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        if (target?.isIntersecting) {
          setInViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px 0px 400px 0px' }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const tone = useMemo(() => {
    if (theme === 'terminal-light') {
      return 'border-slate-300/80 bg-white text-slate-900';
    }
    return 'border-slate-700/50 bg-slate-900/50 text-slate-100';
  }, [theme]);

  return (
    <section
      ref={hostRef}
      className={`rounded-2xl border backdrop-blur-sm transition-colors ${tone}`}
      style={{ minHeight: plugin.minHeightPx ?? 320 }}
      aria-label={plugin.title}
    >
      <header className="sticky top-[5.1rem] z-10 rounded-t-2xl border-b border-inherit bg-inherit/95 px-4 py-3 backdrop-blur-md">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold uppercase tracking-[0.12em]">{plugin.title}</h3>
            <p className="truncate text-xs text-slate-400">{plugin.subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase ${HEALTH_TONE[plugin.health]}`}>
              {plugin.health}
            </span>
            {plugin.supportsCollapse && (
              <button
                type="button"
                className="rounded-md border border-slate-600/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide hover:bg-slate-700/30"
                onClick={() => setCollapsed((value) => !value)}
                aria-expanded={!collapsed}
              >
                {collapsed ? 'Expand' : 'Collapse'}
              </button>
            )}
          </div>
        </div>
      </header>

      {!collapsed && (
        <div className="p-3 sm:p-4">{inViewport ? plugin.render(context) : <ModuleSkeleton />}</div>
      )}
    </section>
  );
}

function ModuleSkeleton(): JSX.Element {
  return (
    <div className="animate-pulse rounded-xl border border-slate-700/40 bg-slate-900/30 p-4">
      <div className="mb-3 h-4 w-44 rounded bg-slate-700/50" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-24 rounded bg-slate-700/30" />
        <div className="h-24 rounded bg-slate-700/30" />
      </div>
    </div>
  );
}
