'use client';

/** Mini sparkline using inline SVG; no extra deps. */
import { useMemo } from 'react';

export default function Sparkline({
  data, width = 110, height = 36, stroke = '#22d3ee', fill = 'rgba(34,211,238,0.18)',
}: { data: number[]; width?: number; height?: number; stroke?: string; fill?: string }) {
  const path = useMemo(() => {
    if (!data || data.length < 2) return { line: '', area: '' };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const step = width / (data.length - 1);
    const pts = data.map((v, i) => [i * step, height - ((v - min) / range) * (height - 4) - 2] as const);
    const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${width},${height} L0,${height} Z`;
    return { line, area };
  }, [data, width, height]);

  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={path.area} fill={fill} />
      <path d={path.line} fill="none" stroke={stroke} strokeWidth={1.4} />
    </svg>
  );
}
