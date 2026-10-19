export interface TradeLabelAnchor {
  id: string;
  x: number;
  y: number;
  width: number;
}

export function layoutTradeLabels(anchors: TradeLabelAnchor[], plotWidth: number, plotHeight: number) {
  const padding = 4;
  const height = 22;
  const gap = 5;
  if (!Number.isFinite(plotWidth) || !Number.isFinite(plotHeight) ||
      plotWidth < 80 || plotHeight < anchors.length * (height + gap) + padding * 2) return [];
  const sorted = anchors.filter(anchor => [anchor.x, anchor.y, anchor.width].every(Number.isFinite))
    .map(anchor => ({ ...anchor, width: Math.min(anchor.width, plotWidth - padding * 2) }))
    .sort((a, b) => a.y - b.y);
  const labels = sorted.map(anchor => ({
    ...anchor,
    anchorX: Math.max(padding, Math.min(anchor.x, plotWidth - padding)),
    anchorY: Math.max(padding, Math.min(anchor.y, plotHeight - padding)),
    x: Math.max(padding, Math.min(anchor.x + 16, plotWidth - anchor.width - padding)),
    y: Math.max(padding, Math.min(anchor.y - height / 2, plotHeight - height - padding)),
    height,
    onScreen: anchor.x >= 0 && anchor.x <= plotWidth && anchor.y >= 0 && anchor.y <= plotHeight,
  }));
  for (let i = 1; i < labels.length; i++) {
    labels[i].y = Math.max(labels[i].y, labels[i - 1].y + height + gap);
  }
  if (labels.length) labels[labels.length - 1].y = Math.min(labels[labels.length - 1].y, plotHeight - height - padding);
  for (let i = labels.length - 2; i >= 0; i--) {
    labels[i].y = Math.min(labels[i].y, labels[i + 1].y - height - gap);
  }
  return labels;
}
