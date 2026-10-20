import type {
  IChartApi, ISeriesApi, ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView,
  SeriesAttachedParameter, SeriesType, Time,
} from 'lightweight-charts';

export type SignalLabelKind = 'BUY' | 'SELL' | 'EXIT';

export interface ChartSignalLabel {
  id: string;
  time: number;
  /** Exact execution price; marked with a pointer beside the candle. */
  price: number;
  kind: SignalLabelKind;
  text: string;
  /** Optional P&L suffix, coloured by its sign. */
  detail?: string;
  detailPositive?: boolean;
  placement: 'above' | 'below';
  early?: boolean;
  /** Second, smaller line (order-flow callouts). */
  subtitle?: string;
  /** 'flow' = dark outlined callout coloured by side, used for buy / sell order-flow bars. */
  variant?: 'solid' | 'flow';
}

export interface SignalLabelBar { time: number; h: number; l: number }

interface Box { x0: number; x1: number; y0: number; y1: number }

const THEME: Record<SignalLabelKind, { fill: string; text: string; border: string }> = {
  BUY: { fill: '#00c896', text: '#03231a', border: '#5dffd0' },
  SELL: { fill: '#ff4d5e', text: '#ffffff', border: '#ff9aa4' },
  EXIT: { fill: '#10212c', text: '#ffcf4a', border: '#ffcf4a' },
};
const GAP = 9;
const STACK_LIMIT = 4;

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 + 3 && b.x0 < a.x1 + 3 && a.y0 < b.y1 + 2 && b.y0 < a.y1 + 2;

/**
 * Canvas layer for BUY / SELL / EXIT pills. Labels sit beyond the wicks of every candle they span,
 * stack instead of overlapping each other, and redraw with the chart (no React work on scroll/zoom).
 */
export class SignalLabelPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private labels: ChartSignalLabel[] = [];
  private bars: SignalLabelBar[] = [];
  private readonly views: readonly ISeriesPrimitivePaneView[];
  /** Lowest usable fraction of the pane height (keeps labels off a volume band sharing the pane). */
  private readonly maxBottom: number;

  constructor(options: { maxBottom?: number } = {}) {
    this.maxBottom = options.maxBottom ?? 1;
    const renderer: ISeriesPrimitivePaneRenderer = {
      draw: target => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.draw(context, mediaSize.width, mediaSize.height)),
    };
    this.views = [{ zOrder: () => 'top', renderer: () => (this.labels.length ? renderer : null) }];
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

  setData(labels: ChartSignalLabel[], bars: SignalLabelBar[]) {
    // Trade labels claim space first; order-flow callouts fill the gaps and are dropped when crowded.
    this.labels = [...labels].sort((a, b) => Number(a.variant === 'flow') - Number(b.variant === 'flow') || a.time - b.time);
    this.bars = bars;
    this.requestUpdate?.();
  }

  private barIndex(time: number) {
    let low = 0, high = this.bars.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.bars[mid].time < time) low = mid + 1;
      else high = mid - 1;
    }
    return low;
  }

  private draw(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const chart = this.chart, series = this.series;
    if (!chart || !series || !this.bars.length) return;
    const timeScale = chart.timeScale();
    const spacing = Math.max(1, timeScale.options().barSpacing);
    const compact = width < 520;
    const font = compact ? 10 : 11;
    const lineHeight = font + 8;
    const mainFont = `700 ${font}px Inter, "Segoe UI", Roboto, Arial, sans-serif`;
    const detailFont = `700 ${font - 1}px Inter, "Segoe UI", Roboto, Arial, sans-serif`;
    const placed: Box[] = [];
    ctx.save();
    ctx.textBaseline = 'middle';
    for (const label of this.labels) {
      const x = timeScale.timeToCoordinate(label.time as Time);
      if (x === null || x < 0 || x > width) continue;
      const theme = THEME[label.kind];
      const above = label.placement === 'above';
      ctx.font = mainFont;
      const mainWidth = ctx.measureText(label.text).width;
      ctx.font = detailFont;
      const detailWidth = label.detail ? ctx.measureText(label.detail).width + 6 : 0;
      const subtitleWidth = label.subtitle ? ctx.measureText(label.subtitle).width : 0;
      const boxWidth = Math.ceil(Math.max(mainWidth + detailWidth, subtitleWidth) + 14);
      const boxHeight = lineHeight + (label.subtitle ? font + 1 : 0);
      const flow = label.variant === 'flow';

      // Clear every candle the pill spans horizontally, not just the signal candle.
      const index = this.barIndex(label.time);
      const reach = Math.ceil(boxWidth / 2 / spacing - 0.5);
      let extreme = above ? -Infinity : Infinity;
      for (let k = Math.max(0, index - reach); k <= Math.min(this.bars.length - 1, index + reach); k++) {
        extreme = above ? Math.max(extreme, this.bars[k].h) : Math.min(extreme, this.bars[k].l);
      }
      const own = this.bars[Math.min(index, this.bars.length - 1)];
      const edgeY = series.priceToCoordinate(extreme);
      const wickY = series.priceToCoordinate(above ? own.h : own.l);
      if (edgeY === null || wickY === null || wickY < 0 || wickY > height) continue;

      const x0 = Math.min(Math.max(2, x - boxWidth / 2), width - 2 - boxWidth);
      const box: Box = { x0, x1: x0 + boxWidth, y0: 0, y1: 0 };
      let y0 = above ? edgeY - GAP - 10 - boxHeight : edgeY + GAP + 10;
      let fits = false;
      const tries = flow ? 2 : STACK_LIMIT;
      for (let attempt = 0; attempt < tries; attempt++) {
        box.y0 = y0; box.y1 = y0 + boxHeight;
        if (!placed.some(other => overlaps(box, other))) { fits = true; break; }
        y0 += above ? -(boxHeight + 4) : boxHeight + 4;
      }
      // Never pin labels to the pane edge, where they would pile up away from their candle.
      if (!fits || box.y0 < 2 || box.y1 > height * this.maxBottom - 2) continue;
      const tipY = above ? wickY - 3 : wickY + 3;
      const tailY = above ? box.y1 : box.y0;
      const stem: Box = { x0: x - 5, x1: x + 5, y0: Math.min(tipY, tailY), y1: Math.max(tipY, tailY) };
      if (placed.some(other => overlaps(stem, other))) continue;
      placed.push({ ...box }, stem);

      // Arrow from the pill to this label's own candle wick (BUY points up, SELL down, EXIT toward its candle).
      ctx.strokeStyle = theme.border;
      ctx.fillStyle = theme.border;
      ctx.lineWidth = 2;
      if (Math.abs(tipY - tailY) > 7) {
        ctx.beginPath();
        ctx.moveTo(x, tailY);
        ctx.lineTo(x, above ? tipY - 6 : tipY + 6);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(x, tipY);
      ctx.lineTo(x - 5, above ? tipY - 7 : tipY + 7);
      ctx.lineTo(x + 5, above ? tipY - 7 : tipY + 7);
      ctx.closePath();
      ctx.fill();

      roundedRect(ctx, box.x0, box.y0, boxWidth, boxHeight, 4);
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = label.early || flow ? 'rgba(8, 24, 34, 0.92)' : theme.fill;
      ctx.fill();
      ctx.shadowBlur = 0;
      if (label.early || flow || label.kind === 'EXIT') {
        ctx.setLineDash(label.early ? [3, 2] : []);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = theme.border;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.font = mainFont;
      ctx.fillStyle = label.early || flow ? theme.border : theme.text;
      ctx.textAlign = 'left';
      const textY = box.y0 + lineHeight / 2 + 0.5;
      ctx.fillText(label.text, box.x0 + 7, textY);
      if (label.detail) {
        ctx.font = detailFont;
        ctx.fillStyle = label.detailPositive ? '#3dffb5' : '#ff7a87';
        ctx.fillText(label.detail, box.x0 + 7 + mainWidth + 6, textY);
      }
      if (label.subtitle) {
        ctx.font = detailFont;
        ctx.fillStyle = '#c9d6e0';
        ctx.fillText(label.subtitle, box.x0 + 7, box.y0 + lineHeight + font / 2 - 2);
      }
    }
    ctx.restore();
  }
}
