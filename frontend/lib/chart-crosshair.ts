import type { IChartApi, ISeriesApi, MouseEventParams } from 'lightweight-charts';

type CrosshairSeries = ISeriesApi<'Candlestick'> | ISeriesApi<'Histogram'> | ISeriesApi<'Line'>;

export function synchronizeCrosshair(
  chart: IChartApi,
  series: CrosshairSeries,
  container: HTMLElement,
  event: MouseEventParams,
): void {
  const clear = () => chart.clearCrosshairPosition();
  if (!container.isConnected || container.clientWidth <= 0 || container.clientHeight <= 0 ||
      event.time === undefined || !event.point || !Number.isFinite(event.point.x) ||
      !Number.isFinite(event.point.y) || !series.options().visible) {
    clear();
    return;
  }
  const scale = chart.timeScale();
  const coordinate = scale.timeToCoordinate(event.time);
  const visible = scale.getVisibleLogicalRange();
  if (coordinate === null || !Number.isFinite(coordinate) || visible === null) {
    clear();
    return;
  }
  const logical = scale.coordinateToLogical(coordinate);
  if (logical === null || !Number.isFinite(logical)) {
    clear();
    return;
  }
  const point = series.dataByIndex(Math.round(logical));
  const value = point && ('close' in point ? point.close : 'value' in point ? point.value : undefined);
  if (!point || point.time !== event.time || typeof value !== 'number' || !Number.isFinite(value)) {
    clear();
    return;
  }
  // A known bar can exist while the visible range has no price-scale first value.
  const priceCoordinate = series.priceToCoordinate(value);
  if (priceCoordinate === null || !Number.isFinite(priceCoordinate)) {
    clear();
    return;
  }
  chart.setCrosshairPosition(value, event.time, series);
}
