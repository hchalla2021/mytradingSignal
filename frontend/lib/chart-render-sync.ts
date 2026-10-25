import type { IChartApi, LogicalRange } from 'lightweight-charts';

export function centeredCandleRange(count: number, plotWidth: number): LogicalRange | null {
  if (count < 1 || plotWidth <= 0) return null;
  const capacity = Math.max(20, Math.min(160, Math.floor(plotWidth / 9)));
  const padding = Math.max(2, Math.round(capacity * 0.06));
  const visible = Math.min(count, capacity - padding * 2);
  const latest = count - 1;
  const span = Math.max(20, visible - 1 + padding * 2);
  const middle = latest - (visible - 1) / 2;
  return { from: middle - span / 2, to: middle + span / 2 } as LogicalRange;
}

export function centerLatestCandle(chart: IChartApi, container: HTMLElement, count: number): boolean {
  if (container.clientWidth <= 0 || container.clientHeight <= 0) return false;
  const next = centeredCandleRange(count, chart.timeScale().width());
  if (!next) return false;
  chart.timeScale().setVisibleLogicalRange(next);
  return true;
}

export function isLatestCandleCentered(chart: IChartApi, count: number): boolean {
  const range = chart.timeScale().getVisibleLogicalRange();
  const expected = centeredCandleRange(count, chart.timeScale().width());
  return range !== null && expected !== null &&
    Math.abs(range.from - expected.from) < 1 && Math.abs(range.to - expected.to) < 1;
}

export function synchronizeChartRange(chart: IChartApi, container: HTMLElement, next: LogicalRange): void {
  if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
  const scale = chart.timeScale();
  const current = scale.getVisibleLogicalRange();
  if (current && Math.abs(current.from - next.from) < 0.001 && Math.abs(current.to - next.to) < 0.001) return;
  scale.setVisibleLogicalRange(next);
}

export function resizeChartIfChanged(chart: IChartApi, container: HTMLElement): boolean {
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width <= 0 || height <= 0) return false;
  const options = chart.options();
  if (options.width === width && options.height === height) return false;
  chart.resize(width, height);
  return true;
}
