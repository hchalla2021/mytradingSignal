import type { IChartApi, LogicalRange } from 'lightweight-charts';

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
