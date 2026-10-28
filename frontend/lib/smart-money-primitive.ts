import type {
  IChartApi, ISeriesApi, ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView,
  Logical, SeriesAttachedParameter, SeriesType, Time,
} from 'lightweight-charts';
import { blockLabel, effectiveScore, poolLabel, type OrderBlock, type SmartMoney } from './smart-money';

const FONT = 'Inter, "Segoe UI", Roboto, Arial, sans-serif';
const RGB = { bull: '0, 200, 150', bear: '255, 77, 94', BSL: '244, 114, 182', SSL: '34, 211, 238', target: '255, 207, 74' };
const fmt = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
// The terminal's HTML legend overlays the top of the pane; labels stay below it.
const LEGEND_BAND = 26;

interface Visible { blocks: boolean; liquidity: boolean }

/**
 * Draws order / breaker blocks as zones from their origin candle to the right edge, and BSL / SSL pools as
 * lines from the pivot that created them. Zones and lines sit behind the candles; labels are on top and
 * de-collided so the chart never turns into a wall of text.
 */
export class SmartMoneyPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private state: SmartMoney | null = null;
  private visible: Visible = { blocks: true, liquidity: true };
  private readonly views: readonly ISeriesPrimitivePaneView[];

  constructor() {
    const back: ISeriesPrimitivePaneRenderer = {
      draw: target => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.drawShapes(context, mediaSize.width, mediaSize.height)),
    };
    const front: ISeriesPrimitivePaneRenderer = {
      draw: target => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.drawLabels(context, mediaSize.width, mediaSize.height)),
    };
    const has = () => !!this.state && (this.visible.blocks || this.visible.liquidity);
    this.views = [
      { zOrder: () => 'bottom', renderer: () => (has() ? back : null) },
      { zOrder: () => 'top', renderer: () => (has() ? front : null) },
    ];
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>) {
    this.chart = chart;
    this.series = series;
    this.requestUpdate = requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews() {
    return this.views;
  }

  setData(state: SmartMoney | null, visible: Visible) {
    if (state === this.state && visible.blocks === this.visible.blocks && visible.liquidity === this.visible.liquidity) return;
    this.state = state;
    this.visible = visible;
    this.requestUpdate?.();
  }

  private x(index: number) {
    return this.chart?.timeScale().logicalToCoordinate(index as Logical) ?? null;
  }

  private y(price: number) {
    return this.series?.priceToCoordinate(price) ?? null;
  }

  private spacing() {
    return Math.max(1, this.chart?.timeScale().options().barSpacing ?? 6);
  }

  private blockBox(block: OrderBlock, width: number) {
    const top = this.y(block.top), bottom = this.y(block.bottom);
    if (top === null || bottom === null) return null;
    const half = this.spacing() / 2;
    const x0 = (this.x(block.start) ?? -half) - half;
    const x1 = block.end === null ? width : (this.x(block.end) ?? width) + half;
    if (x1 < 0 || x0 > width) return null;
    return { x0: Math.max(0, x0), x1: Math.min(width, x1), top: Math.min(top, bottom), bottom: Math.max(top, bottom) };
  }

  private drawShapes(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const state = this.state;
    if (!state) return;
    ctx.save();
    if (this.visible.blocks) {
      for (const block of state.blocks) {
        const box = this.blockBox(block, width);
        if (!box || box.bottom < 0 || box.top > height) continue;
        const rgb = RGB[block.side];
        const live = state.price <= block.top && state.price >= block.bottom;
        const strength = effectiveScore(block) / 100;
        const breaker = block.kind === 'BREAKER';
        ctx.fillStyle = `rgba(${rgb}, ${(breaker ? 0.05 : 0.07) + strength * 0.1 + (live ? 0.1 : 0)})`;
        ctx.fillRect(box.x0, box.top, box.x1 - box.x0, Math.max(2, box.bottom - box.top));
        ctx.strokeStyle = `rgba(${rgb}, ${live ? 0.95 : 0.55})`;
        ctx.lineWidth = live ? 1.5 : 1;
        ctx.setLineDash(breaker ? [5, 3] : []);
        ctx.strokeRect(box.x0 + 0.5, box.top + 0.5, box.x1 - box.x0 - 1, Math.max(1, box.bottom - box.top - 1));
        // 50% mean threshold: institutions defend it; a close beyond it weakens the zone.
        if (box.bottom - box.top >= 8) {
          const mid = (box.top + box.bottom) / 2;
          ctx.setLineDash([2, 3]);
          ctx.strokeStyle = `rgba(${rgb}, 0.45)`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(box.x0, mid); ctx.lineTo(box.x1, mid); ctx.stroke();
        }
      }
    }
    if (this.visible.liquidity) {
      const half = this.spacing() / 2;
      for (const pool of state.pools) {
        const y = this.y(pool.price);
        if (y === null || y < -4 || y > height + 4) continue;
        const start = this.x(pool.start);
        const x0 = Math.max(0, (start ?? 0));
        const resting = pool.state === 'RESTING';
        const x1 = resting ? width : Math.min(width, (this.x(pool.sweptAt ?? state.lastIndex) ?? width) + half);
        if (x1 <= x0) continue;
        const target = state.target === pool;
        const rgb = target ? RGB.target : RGB[pool.side];
        ctx.strokeStyle = `rgba(${rgb}, ${resting ? (target ? 0.95 : 0.8) : 0.4})`;
        ctx.lineWidth = target || pool.touches > 1 || pool.source === 'PDH' || pool.source === 'PDL' ? 1.6 : 1;
        ctx.setLineDash(resting ? [6, 4] : [2, 4]);
        ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(x1, Math.round(y) + 0.5); ctx.stroke();
        if (start !== null && start >= 0) {
          ctx.setLineDash([]);
          ctx.fillStyle = `rgba(${rgb}, 0.9)`;
          ctx.beginPath(); ctx.arc(start, y, 2.5, 0, Math.PI * 2); ctx.fill();
        }
        if (!resting && pool.sweptAt !== null) this.cross(ctx, this.x(pool.sweptAt), y, rgb);
      }
    }
    ctx.restore();
  }

  private cross(ctx: CanvasRenderingContext2D, x: number | null, y: number, rgb: string) {
    if (x === null) return;
    ctx.setLineDash([]);
    ctx.strokeStyle = `rgba(${rgb}, 0.95)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4);
    ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4);
    ctx.stroke();
  }

  private drawLabels(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const state = this.state;
    if (!state) return;
    const compact = width < 560;
    const size = compact ? 9 : 10;
    const taken: [number, number, number, number][] = [];
    const free = (x: number, y: number, w: number, h: number) =>
      !taken.some(([a, b, c, d]) => x < c + 2 && a < x + w + 2 && y < d + 1 && b < y + h + 1);
    const pill = (text: string, x: number, y: number, rgb: string, align: 'left' | 'right', strong = false) => {
      ctx.font = `${strong ? 800 : 700} ${size}px ${FONT}`;
      const w = Math.ceil(ctx.measureText(text).width) + 10, h = size + 6;
      let left = align === 'left' ? x : x - w;
      left = Math.max(2, Math.min(width - w - 2, left));
      let top = Math.max(LEGEND_BAND, y - h / 2);
      for (let step = 0; step < 4 && !free(left, top, w, h); step++) top += (step % 2 ? -1 : 1) * (step + 1) * (h + 2);
      if (top < LEGEND_BAND || top + h > height - 1 || !free(left, top, w, h)) return;
      taken.push([left, top, left + w, top + h]);
      ctx.fillStyle = 'rgba(6, 16, 26, 0.88)';
      ctx.strokeStyle = `rgba(${rgb}, 0.85)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(left, top, w, h, 4); else ctx.rect(left, top, w, h);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = `rgb(${rgb})`;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, left + 5, top + h / 2 + 0.5);
    };
    ctx.save();
    if (this.visible.liquidity) {
      for (const pool of state.pools) {
        const y = this.y(pool.price);
        if (y === null || y < 0 || y > height) continue;
        const target = state.target === pool;
        const rgb = target ? RGB.target : RGB[pool.side];
        if (pool.state === 'RESTING') {
          const text = `${target ? '🎯 ' : ''}${poolLabel(pool)}${compact ? '' : ` ${fmt(pool.price)}`}`;
          pill(text, width - 8, pool.side === 'BSL' ? y - 8 : y + 8, rgb, 'right', target);
        } else {
          const x = this.x(pool.sweptAt ?? state.lastIndex);
          if (x === null || x < 0 || x > width) continue;
          const word = pool.state === 'SWEPT' ? 'swept' : pool.state === 'TAKEN' ? 'taken' : 'sweeping';
          pill(`${pool.side} ${word}`, x + 8, pool.side === 'BSL' ? y - 10 : y + 10, rgb, 'left');
        }
      }
    }
    if (this.visible.blocks) {
      for (const block of state.blocks) {
        const box = this.blockBox(block, width);
        if (!box || box.bottom < 0 || box.top > height) continue;
        const flags = [block.choch && 'CHoCH', block.fvg && 'FVG', block.touches ? `${block.touches}× tested` : 'fresh']
          .filter(Boolean).join(' · ');
        const text = compact ? `${blockLabel(block)} ${effectiveScore(block)}` : `${blockLabel(block)} ${effectiveScore(block)} · ${flags}`;
        const anchor = block.side === 'bull' ? box.bottom - 9 : box.top + 9;
        pill(text, box.x0 + 4, Math.max(10, Math.min(height - 10, anchor)), RGB[block.side], 'left');
      }
    }
    ctx.restore();
  }
}
