'use client';

import { useMemo } from 'react';
import type { ProState } from '@/hooks/useProConfluence';
import { activeBattles, chartLevels, levelBattles, type LevelBar, type LevelBattle } from '@/lib/level-battle';

export interface LevelBattleState {
  /** Levels being tested now (or the nearest one on each side), top to bottom. */
  active: LevelBattle[];
  price: number | null;
  /** True when buyers/sellers could be measured in futures for this chart. */
  mapped: boolean;
}

const NONE: LevelBattleState = { active: [], price: null, mapped: false };

/**
 * Reads the chart's own levels and measures the battle at them with the shared near-month 5m futures recording.
 * `offset` = futures − chart price (0 on the near-month futures chart, basis on the cash chart, null if unrelated).
 */
export function useLevelBattle(pro: ProState, bars: readonly LevelBar[] | null, options: { intraday: boolean; vwap: boolean; offset: number | null }): LevelBattleState {
  const { intraday, vwap, offset } = options;
  const levels = useMemo(() => (bars?.length ? chartLevels(bars, { intraday, vwap }) : []), [bars, intraday, vwap]);
  const price = bars?.length ? bars[bars.length - 1].c : null;
  return useMemo(() => {
    if (price == null || !levels.length) return NONE;
    const battles = levelBattles({
      levels, price, futures: pro.bars, flowBars: pro.snapshot?.bars ?? [], dom: pro.snapshot?.dom ?? null, offset,
    });
    return { active: activeBattles(battles), price, mapped: offset != null };
  }, [levels, price, pro.bars, pro.snapshot, offset]);
}
