import type {
  IChartApi, ISeriesApi, ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView,
  SeriesAttachedParameter, SeriesType, Time,
} from 'lightweight-charts';
import type { ChartSignalLabel } from '@/lib/chart-signal-labels';
import {
  basisAt, bucketSize, coarsenLevels, compactVolume, sessionLevels,
  type OrderFlowBar, type OrderFlowLevel, type OrderFlowSnapshot, type ValidatedFlow,
} from '@/lib/order-flow';

export interface OrderFlowLayerOptions {
  /** Full overlay (profile, value area, walls, delta strip, footprint, event marks, plan). Off = candle shading only. */
  detail?: boolean;
  /** Draw bid x ask footprint cells when candles are wide enough (futures chart only). */
  footprint: boolean;
  /** Shift futures prices onto a cash-index chart using each bar's recorded basis. */
  basisAdjust: boolean;
  /** Vertical band (fractions of pane height) for the delta / CVD strip; must be outside the candle margin. */
  strip: { top: number; bottom: number };
  /** Draw the server order-flow trade plan (entry / SL / targets). Defaults to true. */
  plan?: boolean;
}

const BUY = '#00d39b';
const SELL = '#ff4d5e';
const POC = '#ffb547';
const VALUE = '#7fb4d6';
const FONT = 'Inter, "Segoe UI", Roboto, Arial, sans-serif';
const FOOTPRINT_SPACING = 56;
const MARKS: Record<string, string> = {
  absorption_sellers: 'A', absorption_buyers: 'A', exhaustion_sellers: 'E', exhaustion_buyers: 'E',
  failed_breakdown: 'F', failed_breakout: 'F',
};
const BULL_MARKS = new Set(['absorption_sellers', 'exhaustion_sellers', 'failed_breakdown']);

interface Frame {
  ctx: CanvasRenderingContext2D; width: number; height: number;
  x: (time: number) => number | null; y: (price: number) => number | null; spacing: number;
}

/**
 * Order-flow canvas layer for lightweight-charts. Everything is drawn from the latest snapshot on each
 * chart repaint (scroll/zoom never touches React). Background view: session profile, value area, liquidity
 * zones and the delta/CVD strip. Foreground view: footprint cells, imbalance ticks, event letters, live plan.
 */
export class OrderFlowPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private snapshot: OrderFlowSnapshot | null = null;
  private profile: OrderFlowLevel[] = [];
  private estimated: ValidatedFlow[] = [];
  private options: OrderFlowLayerOptions;
  private readonly views: readonly ISeriesPrimitivePaneView[];

  constructor(options: OrderFlowLayerOptions) {
    this.options = options;
    const layer = (fn: (frame: Frame) => void): ISeriesPrimitivePaneRenderer => ({
      draw: target => target.useMediaCoordinateSpace(({ context, mediaSize }) => {
        const frame = this.frame(context, mediaSize.width, mediaSize.height);
        if (frame) { context.save(); fn(frame); context.restore(); }
      }),
    });
    const back = layer(frame => this.drawBackground(frame));
    const front = layer(frame => this.drawForeground(frame));
    this.views = [
      { zOrder: () => 'bottom', renderer: () => (this.snapshot?.bars.length || this.estimated.length ? back : null) },
      { zOrder: () => 'top', renderer: () => (this.options.detail && this.snapshot?.bars.length ? front : null) },
    ];
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>) {
    this.chart = chart; this.series = series; this.requestUpdate = requestUpdate;
  }

  detached() {
    this.chart = null; this.series = null; this.requestUpdate = null;
  }

  paneViews() {
    return this.views;
  }

  setData(snapshot: OrderFlowSnapshot | null, options?: Partial<OrderFlowLayerOptions>) {
    if (options) this.options = { ...this.options, ...options };
    this.snapshot = snapshot?.available && snapshot.bars.length ? snapshot : null;
    this.profile = this.snapshot ? sessionLevels(this.snapshot.bars) : [];
    this.requestUpdate?.();
  }

  /** Validated order-flow prints to shade behind their candles. */
  setEstimated(callouts: ValidatedFlow[]) {
    this.estimated = callouts;
    this.requestUpdate?.();
  }

  private frame(ctx: CanvasRenderingContext2D, width: number, height: number): Frame | null {
    const chart = this.chart, series = this.series;
    if (!chart || !series) return null;
    const timeScale = chart.timeScale();
    return {
      ctx, width, height, spacing: Math.max(1, timeScale.options().barSpacing),
      x: time => timeScale.timeToCoordinate(time as Time),
      y: price => series.priceToCoordinate(price),
    };
  }

  /** Price offset for a futures price at `time` (0 on the futures chart, null when it cannot be aligned). */
  private shift(time: number | null): number | null {
    const snapshot = this.snapshot;
    if (!snapshot || !this.options.basisAdjust) return 0;
    return time === null ? snapshot.summary.basis : basisAt(snapshot.bars, time, snapshot.summary.basis);
  }

  private pxPerPrice(frame: Frame, reference: number) {
    const row = this.snapshot?.row ?? 1;
    const a = frame.y(reference), b = frame.y(reference + row * 10);
    return a === null || b === null ? 0 : Math.abs(a - b) / (row * 10);
  }

  private drawBackground(frame: Frame) {
    const snapshot = this.snapshot;
    const { ctx, width } = frame;
    if (!this.options.detail || !snapshot) { this.drawZones(frame); return; }
    const shift = this.shift(null);
    if (shift !== null) {
      this.drawProfile(frame, shift);
      const seen = new Set<string>();
      const zones = [
        ...snapshot.zones.filter(zone => zone.status === 'active').slice(0, 4),
        ...snapshot.zones.filter(zone => zone.status === 'broken').slice(0, 2),
      ].filter(zone => {
        const id = `${zone.side}:${zone.price}`;
        return !seen.has(id) && Boolean(seen.add(id));
      });
      for (const zone of zones) {
        const y = frame.y(zone.price - shift);
        if (y === null) continue;
        const color = zone.side === 'bid' ? BUY : SELL;
        const thick = Math.max(2, this.pxPerPrice(frame, zone.price - shift) * snapshot.row);
        ctx.globalAlpha = zone.status === 'active' ? 0.13 : 0.06;
        ctx.fillStyle = color;
        ctx.fillRect(0, y - thick / 2, width, thick);
        if (zone.status !== 'active') continue;
        // Wall labels sit under their band on the left; value-area labels sit above their line.
        ctx.globalAlpha = 0.8;
        ctx.font = `600 9px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(`${zone.side === 'bid' ? 'BID' : 'ASK'} WALL ${compactVolume(zone.maxQty)}`, 4, y + thick / 2 + 1);
      }
      ctx.globalAlpha = 1;
      if (snapshot.profile) {
        const levels: [string, number, string, number[]][] = [
          ['VAH', snapshot.profile.vah, VALUE, [5, 4]], ['POC', snapshot.profile.poc, POC, []], ['VAL', snapshot.profile.val, VALUE, [5, 4]],
        ];
        ctx.font = `700 9px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        for (const [name, price, color, dash] of levels) {
          const y = frame.y(price - shift);
          if (y === null || y < 0 || y > frame.height) continue;
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.globalAlpha = name === 'POC' ? 0.85 : 0.55;
          ctx.lineWidth = 1;
          ctx.setLineDash(dash);
          ctx.beginPath();
          ctx.moveTo(0, Math.round(y) + 0.5);
          ctx.lineTo(width, Math.round(y) + 0.5);
          ctx.stroke();
          ctx.fillText(`${name} ${(price - shift).toFixed(1)}`, 4, y - 2);
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }
    this.drawZones(frame);
    this.drawStrip(frame);
  }

  /** Shading over validated (confirmed) and live (pending) order-flow candles only. */
  private drawZones(frame: Frame) {
    const { ctx, spacing } = frame;
    for (const flow of this.estimated) {
      if (flow.status === 'failed') continue;
      const x = frame.x(flow.t);
      if (x === null || x < -spacing || x > frame.width + spacing) continue;
      const top = frame.y(flow.high), bottom = frame.y(flow.low);
      if (top === null || bottom === null) continue;
      const half = Math.max(4, spacing * 0.55);
      ctx.globalAlpha = flow.status === 'pending' ? 0.1 : 0.18;
      ctx.fillStyle = flow.side === 'BUY' ? BUY : SELL;
      ctx.fillRect(x - half, top - 3, half * 2, bottom - top + 6);
    }
    ctx.globalAlpha = 1;
  }

  /** Session volume-at-price at the right edge, split buy (estimated) / sell (estimated). */
  private drawProfile(frame: Frame, shift: number) {
    const { ctx, width } = frame;
    if (!this.profile.length) return;
    const row = this.snapshot!.row;
    const ppp = this.pxPerPrice(frame, this.profile[0][0] - shift);
    if (ppp <= 0) return;
    const rows = coarsenLevels(this.profile, row, 3 / ppp);
    const size = bucketSize(row, 3 / ppp);
    const max = Math.max(...rows.map(([, b, s]) => b + s));
    if (max <= 0) return;
    const maxWidth = Math.min(72, width * 0.14);
    ctx.globalAlpha = 0.32;
    for (const [price, buy, sell] of rows) {
      const top = frame.y(price + size - shift), bottom = frame.y(price - shift);
      if (top === null || bottom === null || bottom < 0 || top > frame.height) continue;
      const h = Math.max(1, Math.abs(bottom - top) - 1);
      const total = ((buy + sell) / max) * maxWidth;
      const buyWidth = buy + sell ? total * (buy / (buy + sell)) : 0;
      ctx.fillStyle = SELL;
      ctx.fillRect(width - total, Math.min(top, bottom), total - buyWidth, h);
      ctx.fillStyle = BUY;
      ctx.fillRect(width - buyWidth, Math.min(top, bottom), buyWidth, h);
    }
    ctx.globalAlpha = 1;
  }

  /** Per-bar estimated delta (histogram) and cumulative delta (line) in the empty band below the candles. */
  private drawStrip(frame: Frame) {
    const { ctx, height, spacing } = frame;
    const top = height * this.options.strip.top, bottom = height * this.options.strip.bottom;
    const mid = (top + bottom) / 2, half = (bottom - top) / 2 - 1;
    if (half < 4) return;
    const visible: [number, OrderFlowBar][] = [];
    for (const bar of this.snapshot!.bars) {
      const x = frame.x(bar.t);
      if (x !== null && x > -spacing && x < frame.width + spacing) visible.push([x, bar]);
    }
    if (!visible.length) return;
    const maxDelta = Math.max(1, ...visible.map(([, bar]) => Math.abs(bar.d)));
    const cvds = visible.map(([, bar]) => bar.cvd);
    const low = Math.min(...cvds), high = Math.max(...cvds);
    const w = Math.max(1, Math.min(spacing * 0.6, 10));
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#5c7385';
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5); ctx.lineTo(frame.width, mid + 0.5);
    ctx.stroke();
    for (const [x, bar] of visible) {
      const h = (Math.abs(bar.d) / maxDelta) * half;
      ctx.globalAlpha = bar.complete ? 0.75 : 0.35;
      ctx.fillStyle = bar.d >= 0 ? BUY : SELL;
      ctx.fillRect(x - w / 2, bar.d >= 0 ? mid - h : mid, w, Math.max(1, h));
    }
    if (visible.length > 1) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = POC;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      visible.forEach(([x, bar], i) => {
        const y = high > low ? bottom - 1 - ((bar.cvd - low) / (high - low)) * (bottom - top - 2) : mid;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    const last = visible[visible.length - 1][1];
    ctx.globalAlpha = 0.85;
    ctx.font = `600 9px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#94aabd';
    ctx.fillText(`Δ ${last.d >= 0 ? '+' : ''}${compactVolume(last.d)} · CVD ${compactVolume(last.cvd)} (est.)`, 4, top);
    ctx.globalAlpha = 1;
  }

  private drawForeground(frame: Frame) {
    const snapshot = this.snapshot!;
    const { ctx, spacing } = frame;
    const footprint = this.options.footprint && spacing >= FOOTPRINT_SPACING;
    ctx.textBaseline = 'middle';
    for (const bar of snapshot.bars) {
      const x = frame.x(bar.t);
      if (x === null || x < -spacing || x > frame.width + spacing) continue;
      const shift = this.shift(bar.t);
      if (shift === null) continue;
      if (footprint && bar.lv.length) this.drawFootprint(frame, bar, x);
      else {
        for (const [side, ranges] of [['buy', bar.imb.buy], ['sell', bar.imb.sell]] as const) {
          for (const [lo, hi] of ranges) {
            const y0 = frame.y(lo - shift), y1 = frame.y(hi + snapshot.row - shift);
            if (y0 === null || y1 === null) continue;
            ctx.fillStyle = side === 'buy' ? BUY : SELL;
            ctx.fillRect(x + Math.max(3, spacing * 0.42), Math.min(y0, y1), 2, Math.max(2, Math.abs(y0 - y1)));
          }
        }
      }
      const marks = bar.flags.filter(flag => MARKS[flag]);
      if (!marks.length) continue;
      const bull = marks.filter(flag => BULL_MARKS.has(flag)).map(flag => MARKS[flag]);
      const bear = marks.filter(flag => !BULL_MARKS.has(flag)).map(flag => MARKS[flag]);
      ctx.font = `800 9px ${FONT}`;
      ctx.textAlign = 'center';
      const low = frame.y(bar.l - shift), high = frame.y(bar.h - shift);
      if (bull.length && low !== null) { ctx.fillStyle = BUY; ctx.fillText(Array.from(new Set(bull)).join(''), x, low + 9); }
      if (bear.length && high !== null) { ctx.fillStyle = SELL; ctx.fillText(Array.from(new Set(bear)).join(''), x, high - 9); }
    }
    this.drawPlan(frame);
  }

  /** Bid (sell, left) x Ask (buy, right) per price row; diagonal 3x imbalances are highlighted. */
  private drawFootprint(frame: Frame, bar: OrderFlowBar, x: number) {
    const { ctx, spacing } = frame;
    const row = this.snapshot!.row;
    const ppp = this.pxPerPrice(frame, bar.c);
    if (ppp <= 0) return;
    const rows = coarsenLevels(bar.lv, row, 12 / ppp);
    const size = bucketSize(row, 12 / ppp);
    const width = Math.min(spacing * 0.9, 120);
    const left = x - width / 2;
    const poc = rows.reduce((best, cell) => cell[1] + cell[2] > best[1] + best[2] ? cell : best, rows[0]);
    const bySize = new Map(rows.map(cell => [Math.round(cell[0] * 100), cell]));
    const fontSize = Math.min(10, Math.max(8, Math.floor(width / 9)));
    ctx.font = `600 ${fontSize}px ${FONT}`;
    for (const cell of rows) {
      const [price, buy, sell] = cell;
      const top = frame.y(price + size), bottom = frame.y(price);
      if (top === null || bottom === null || bottom < 0 || top > frame.height) continue;
      const y = Math.min(top, bottom), h = Math.max(1, Math.abs(bottom - top) - 1);
      const delta = buy - sell, total = buy + sell;
      ctx.fillStyle = 'rgba(0, 17, 28, 0.9)';
      ctx.fillRect(left, y, width, h);
      if (total > 0) {
        ctx.globalAlpha = Math.min(0.45, 0.08 + Math.abs(delta) / total * 0.4);
        ctx.fillStyle = delta >= 0 ? BUY : SELL;
        ctx.fillRect(left, y, width, h);
        ctx.globalAlpha = 1;
      }
      if (cell === poc) {
        ctx.strokeStyle = POC;
        ctx.lineWidth = 1;
        ctx.strokeRect(left + 0.5, y + 0.5, width - 1, h - 1);
      }
      const below = bySize.get(Math.round((price - size) * 100));
      const above = bySize.get(Math.round((price + size) * 100));
      const buyImbalance = buy > 0 && buy >= 3 * Math.max(below?.[2] ?? 0, 1) && below !== undefined;
      const sellImbalance = sell > 0 && sell >= 3 * Math.max(above?.[1] ?? 0, 1) && above !== undefined;
      ctx.textAlign = 'right';
      ctx.fillStyle = sellImbalance ? '#ff7a87' : '#c9d6e0';
      ctx.fillText(compactVolume(sell), x - 3, y + h / 2 + 0.5);
      ctx.fillStyle = '#56697a';
      ctx.textAlign = 'center';
      ctx.fillText('x', x, y + h / 2 + 0.5);
      ctx.textAlign = 'left';
      ctx.fillStyle = buyImbalance ? '#3dffb5' : '#c9d6e0';
      ctx.fillText(compactVolume(buy), x + 3, y + h / 2 + 0.5);
    }
    // Thin candle body on the left edge keeps direction readable under the cells.
    const open = frame.y(bar.o), close = frame.y(bar.c), high = frame.y(bar.h), low = frame.y(bar.l);
    if (open !== null && close !== null && high !== null && low !== null) {
      ctx.fillStyle = bar.c >= bar.o ? BUY : SELL;
      ctx.fillRect(left - 4, Math.min(high, low), 1, Math.abs(low - high));
      ctx.fillRect(left - 5.5, Math.min(open, close), 4, Math.max(1, Math.abs(open - close)));
    }
  }

  /** Active plan only: entry / stop / targets as short dashed segments from the signal bar. */
  private drawPlan(frame: Frame) {
    const guidance = this.snapshot!.guidance;
    if (this.options.plan === false) return;
    if ((guidance.action !== 'BUY' && guidance.action !== 'SELL') || guidance.time === undefined) return;
    const shift = this.shift(guidance.time);
    const start = frame.x(guidance.time);
    if (shift === null || start === null) return;
    const { ctx } = frame;
    const end = Math.max(start + 40, Math.min(frame.width - 84, start + Math.max(140, frame.spacing * 14)));
    const levels: [string, number | undefined, string][] = [
      [guidance.fill ? 'FILL' : 'ENTRY', guidance.fill ?? guidance.entry, '#e7eef4'],
      ['SL', guidance.stopNow ?? guidance.stop, SELL], ['T1', guidance.t1, BUY], ['T2', guidance.t2, BUY],
    ];
    // Labels go after the segment, or before the signal bar when the segment reaches the right edge.
    const labelsRight = frame.width - end >= 76;
    ctx.font = `700 9px ${FONT}`;
    ctx.textAlign = labelsRight ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    for (const [name, price, color] of levels) {
      if (price === undefined) continue;
      const y = frame.y(price - shift);
      if (y === null) continue;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1;
      ctx.setLineDash(name === 'SL' || name.startsWith('T') ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(start, Math.round(y) + 0.5);
      ctx.lineTo(end, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillText(`${name} ${(price - shift).toFixed(1)}`, labelsRight ? end + 4 : start - 6, y);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}

/**
 * BUY / SELL pills at the signal bar (entry, confidence) and EXIT pills where the paper trade closed
 * (net of fees and slippage when the lot size is known). Prices are basis-shifted for the cash chart.
 */
export function orderFlowSignalLabels(snapshot: OrderFlowSnapshot | null, basisAdjust: boolean, limit = 12): ChartSignalLabel[] {
  if (!snapshot?.available) return [];
  const shiftAt = (time: number) => basisAdjust ? basisAt(snapshot.bars, time, snapshot.summary.basis) : 0;
  const labels: ChartSignalLabel[] = [];
  for (const signal of snapshot.signals.filter(item => item.status !== 'expired' && item.status !== 'skipped').slice(-limit)) {
    const shift = shiftAt(signal.time);
    if (shift === null) continue;
    const buy = signal.side === 'BUY';
    const entry = signal.entry - shift;
    labels.push({
      id: signal.id, time: signal.time, price: entry, kind: signal.side, placement: buy ? 'below' : 'above',
      text: `OF ${signal.side} ${entry.toFixed(1)} · ${signal.confidence}`, early: signal.status === 'pending',
    });
    const last = signal.exits[signal.exits.length - 1];
    if (signal.status !== 'closed' || !last) continue;
    const exitShift = shiftAt(last.time) ?? shift;
    const net = signal.pnl?.net;
    const points = signal.points ?? 0;
    labels.push({
      id: `${signal.id}:exit`, time: last.time, price: last.price - exitShift, kind: 'EXIT', placement: buy ? 'above' : 'below',
      text: `EXIT ${(last.price - exitShift).toFixed(1)} ${last.reason}`,
      detail: net !== undefined ? `${net >= 0 ? '+' : '-'}₹${Math.abs(Math.round(net)).toLocaleString('en-IN')}` : `${points >= 0 ? '+' : ''}${points.toFixed(1)} pts`,
      detailPositive: (net ?? points) >= 0,
    });
  }
  return labels;
}

/**
 * Validated order flow only: confirmed prints show the points they actually made; the live (pending) print is
 * dashed until it either makes the minimum points or hits its stop. Failed prints are never drawn.
 */
export function candleFlowLabels(flows: ValidatedFlow[]): ChartSignalLabel[] {
  return flows.filter(flow => flow.status !== 'failed').map(flow => {
    const buy = flow.side === 'BUY';
    const confirmed = flow.status === 'confirmed';
    return {
      id: `flow-${flow.t}-${flow.side}`, time: flow.t, price: flow.price, kind: flow.side, variant: 'flow' as const,
      placement: buy ? 'below' as const : 'above' as const, early: !confirmed,
      text: buy ? 'Buy Order Flow' : 'Sell Order Flow',
      ...(confirmed ? { detail: `+${flow.points.toFixed(0)} pts`, detailPositive: true } : { detail: 'confirming', detailPositive: buy }),
    };
  });
}

/** Valid / total high-conviction prints, for an honest on-screen hit rate. */
export function flowStats(flows: ValidatedFlow[]) {
  const resolved = flows.filter(flow => flow.status !== 'pending');
  const valid = resolved.filter(flow => flow.status === 'confirmed').length;
  return { valid, resolved: resolved.length, pending: flows.length - resolved.length };
}
