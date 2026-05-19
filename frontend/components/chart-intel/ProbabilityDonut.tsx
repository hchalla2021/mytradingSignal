'use client';

/** Conic-gradient donut for buy/sell probability. */
export default function ProbabilityDonut({
  buy, sell, size = 140,
}: { buy: number; sell: number; size?: number }) {
  const total = Math.max(buy + sell, 1e-9);
  const buyPct = Math.round((buy / total) * 100);
  const sellPct = 100 - buyPct;
  const deg = buyPct * 3.6;
  const ring = `conic-gradient(#10e0a3 0deg ${deg}deg, #ff4d6d ${deg}deg 360deg)`;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div
        className="rounded-full"
        style={{ width: size, height: size, background: ring, filter: 'drop-shadow(0 0 12px rgba(34,211,238,0.15))' }}
      />
      <div
        className="absolute rounded-full bg-[#050816] border border-cyan-500/20"
        style={{ inset: 12 }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-bold text-emerald-300">{buyPct}%</div>
        <div className="text-[10px] tracking-[0.2em] text-emerald-300/80">BUY</div>
      </div>
      <div className="absolute -right-2 top-2 text-right">
        <div className="text-xs text-rose-300/90 font-semibold">{sellPct}%</div>
        <div className="text-[9px] tracking-[0.2em] text-rose-300/60">SELL</div>
      </div>
    </div>
  );
}
