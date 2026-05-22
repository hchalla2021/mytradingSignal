'use client';

/** Conic-gradient donut for buy/sell probability. */
export default function ProbabilityDonut({
  buy, sell, size = 140,
}: { buy: number; sell: number; size?: number }) {
  const safeBuy = Number.isFinite(buy) ? Math.max(0, buy) : 0;
  const safeSell = Number.isFinite(sell) ? Math.max(0, sell) : 0;
  const total = Math.max(safeBuy + safeSell, 1e-9);
  const buyPct = Math.round((safeBuy / total) * 100);
  const sellPct = 100 - buyPct;
  const deg = buyPct * 3.6;
  const ring = `conic-gradient(#10e0a3 0deg ${deg}deg, #ff4d6d ${deg}deg 360deg)`;
  const dominantBuy = buyPct >= sellPct;
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
        <div className={`text-2xl font-bold ${dominantBuy ? 'text-emerald-300' : 'text-rose-300'}`}>
          {dominantBuy ? buyPct : sellPct}%
        </div>
        <div className={`text-[10px] tracking-[0.2em] ${dominantBuy ? 'text-emerald-300/80' : 'text-rose-300/80'}`}>
          {dominantBuy ? 'BUY' : 'SELL'}
        </div>
      </div>
      <div className="absolute -right-2 top-2 text-right">
        <div className={`text-xs font-semibold ${dominantBuy ? 'text-rose-300/90' : 'text-emerald-300/90'}`}>
          {dominantBuy ? sellPct : buyPct}%
        </div>
        <div className={`text-[9px] tracking-[0.2em] ${dominantBuy ? 'text-rose-300/60' : 'text-emerald-300/60'}`}>
          {dominantBuy ? 'SELL' : 'BUY'}
        </div>
      </div>
    </div>
  );
}
