import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function ChartIntelIndex() {
  const items = [
    { sym: 'NIFTY', label: 'NIFTY 50' },
    { sym: 'BANKNIFTY', label: 'BANK NIFTY' },
    { sym: 'SENSEX', label: 'SENSEX' },
  ];
  return (
    <main className="min-h-screen bg-[#050816] text-white flex items-center justify-center p-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl w-full">
        {items.map(i => (
          <Link
            key={i.sym}
            href={`/chart-intel/${i.sym}`}
            className="rounded-xl border border-cyan-500/20 bg-gradient-to-br from-[#0a1224] to-[#050816] p-5 hover:border-cyan-400/60 hover:shadow-[0_0_30px_rgba(34,211,238,0.18)] transition"
          >
            <div className="text-[10px] tracking-[0.3em] text-cyan-300/70">REAL-TIME CHART INTEL</div>
            <div className="mt-1 text-xl font-semibold">{i.label}</div>
            <div className="mt-3 text-xs text-slate-400">Open premium SMC dashboard →</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
