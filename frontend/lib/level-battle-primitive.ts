import type {
  IChartApi, ISeriesApi, ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView,
  SeriesAttachedParameter, SeriesType, Time,
} from 'lightweight-charts';
import { compactVolume } from './order-flow';
import { battleHeadline, type LevelBattle } from './level-battle';

const COLORS = {
  up: { band: 'rgba(0, 200, 150, ', text: '#3dffb5' },
  down: { band: 'rgba(255, 77, 94, ', text: '#ff7a87' },
  neutral: { band: 'rgba(255, 207, 74, ', text: '#ffcf4a' },
};

const tone = (battle: LevelBattle) => (battle.up >= 65 ? COLORS.up : battle.down >= 65 ? COLORS.down : COLORS.neutral);
const fmt = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/**
 * Draws the level being fought over: a zone band, and a callout on the right with buyers vs sellers traded in the
 * zone, the REJECT / BREAK split and the points to the next level. The zone flashes while price is inside it.
 */
export class LevelBattlePrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private battles: LevelBattle[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly views: readonly ISeriesPrimitivePaneView[];

  constructor() {
    const renderer: ISeriesPrimitivePaneRenderer = {
      draw: target => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.draw(context, mediaSize.width, mediaSize.height)),
    };
    this.views = [{ zOrder: () => 'top', renderer: () => (this.battles.length ? renderer : null) }];
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>) {
    this.chart = chart;
    this.series = series;
    this.requestUpdate = requestUpdate;
    this.syncTimer();
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
    this.syncTimer();
  }

  paneViews() {
    return this.views;
  }

  setData(battles: LevelBattle[]) {
    this.battles = battles;
    this.syncTimer();
    this.requestUpdate?.();
  }

  private syncTimer() {
    const flashing = !!this.requestUpdate && this.battles.some(battle => battle.state === 'AT');
    if (flashing && !this.timer) this.timer = setInterval(() => this.requestUpdate?.(), 450);
    if (!flashing && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private draw(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const series = this.series;
    if (!series || !this.chart) return;
    const pulse = Math.floor(Date.now() / 450) % 2 === 0;
    const compact = width < 520;
    const font = compact ? 10 : 11;
    const taken: [number, number][] = [];
    ctx.save();
    ctx.textBaseline = 'middle';
    for (const battle of this.battles) {
      const y = series.priceToCoordinate(battle.price);
      if (y === null || y < -20 || y > height + 20) continue;
      const top = series.priceToCoordinate(battle.price + battle.zone) ?? y - 3;
      const bottom = series.priceToCoordinate(battle.price - battle.zone) ?? y + 3;
      const colour = tone(battle);
      const at = battle.state === 'AT';
      const far = battle.state === 'FAR';

      if (!far) {
        ctx.fillStyle = `${colour.band}${at ? (pulse ? 0.34 : 0.14) : 0.1})`;
        ctx.fillRect(0, Math.min(top, bottom), width, Math.max(2, Math.abs(bottom - top)));
      }
      ctx.strokeStyle = `${colour.band}${far ? 0.45 : 0.9})`;
      ctx.lineWidth = at ? 2 : 1;
      ctx.setLineDash(far ? [4, 4] : []);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.setLineDash([]);

      const lines = [
        `${at ? '⚡ ' : ''}${battle.label} ${fmt(battle.price)} · ${battleHeadline(battle)}`,
        battle.flowAvailable
          ? `Buyers ${compactVolume(battle.buy)} · Sellers ${compactVolume(battle.sell)}${battle.bookBid != null ? ` · Book ${compactVolume(battle.bookBid)}/${compactVolume(battle.bookAsk ?? 0)}` : ''}`
          : 'No recorded buyers/sellers here yet',
        [battle.above && `↑ ${battle.above.label} +${fmt(battle.above.points)}`, battle.below && `↓ ${battle.below.label} −${fmt(battle.below.points)}`]
          .filter(Boolean).join(' · '),
      ].filter(Boolean);
      if (far) lines.splice(1);
      const lineHeight = font + 5;
      const boxHeight = lines.length * lineHeight + 6;
      ctx.font = `700 ${font}px Inter, "Segoe UI", Roboto, Arial, sans-serif`;
      const boxWidth = Math.min(width - 16, Math.ceil(Math.max(...lines.map(line => ctx.measureText(line).width)) + 16));
      let y0 = battle.role === 'SUPPORT' ? y + 6 : y - 6 - boxHeight;
      for (const [a, b] of taken) {
        if (y0 < b + 2 && a < y0 + boxHeight + 2) y0 = battle.role === 'SUPPORT' ? b + 4 : a - boxHeight - 4;
      }
      if (y0 < 2 || y0 + boxHeight > height - 2) continue;
      taken.push([y0, y0 + boxHeight]);
      const x0 = width - boxWidth - 8;
      ctx.fillStyle = 'rgba(8, 18, 28, 0.92)';
      ctx.strokeStyle = at && pulse ? colour.text : `${colour.band}0.8)`;
      ctx.lineWidth = at ? 2 : 1;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(x0, y0, boxWidth, boxHeight, 5);
      else ctx.rect(x0, y0, boxWidth, boxHeight);
      ctx.fill();
      ctx.stroke();
      lines.forEach((line, index) => {
        ctx.font = `${index ? 600 : 700} ${index ? font - 1 : font}px Inter, "Segoe UI", Roboto, Arial, sans-serif`;
        ctx.fillStyle = index ? '#c9d6e0' : colour.text;
        ctx.fillText(line, x0 + 8, y0 + 3 + lineHeight * index + lineHeight / 2);
      });
    }
    ctx.restore();
  }
}
