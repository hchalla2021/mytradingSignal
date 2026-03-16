'use client';

import React, { useState } from 'react';

const SECTIONS = [
  {
    num: '01', name: 'Institutional Volume Pulse',
    param: 'Buy Vol > Sell Vol',
    buy: 'Inst. Buy > Sell',
    sell: 'Inst. Sell > Buy',
    skip: 'Neutral volumes',
  },
  {
    num: '02', name: 'Candle Intent',
    param: 'Intent Strength + Dir',
    buy: 'Strong Bullish Intent',
    sell: 'Strong Bearish Intent',
    skip: 'Weak / Mixed',
  },
  {
    num: '03', name: 'Open Breakout',
    param: '15-min Break + Volume',
    buy: 'Break UP + volume',
    sell: 'Break DOWN + volume',
    skip: 'No volume / fake',
  },
  {
    num: '04', name: 'Support Trend',
    param: 'HH-HL / LH-LL',
    buy: 'Higher High + Higher Low',
    sell: 'Lower High + Lower Low',
    skip: 'Sideways',
  },
  {
    num: '05', name: 'Parabolic Trend',
    param: 'Dot Position',
    buy: 'Dots below price',
    sell: 'Dots above price',
    skip: 'Flip happening → Wait',
  },
  {
    num: '06', name: 'Camera Law',
    param: 'Liquidity Sweep Dir',
    buy: 'Downside sweep + reversal',
    sell: 'Upside sweep + rejection',
    skip: '–',
  },
  {
    num: '07', name: 'S3VM',
    param: 'Model Signal Dir',
    buy: 'Confirmed Buy signal',
    sell: 'Confirmed Sell signal',
    skip: 'Model Neutral → Skip',
  },
  {
    num: '08', name: 'Smart Money Flow',
    param: 'Net Inst. Flow',
    buy: 'Positive accumulation',
    sell: 'Distribution phase',
    skip: '–',
  },
  {
    num: '09', name: 'Trade Zones',
    param: 'Aggression Strength',
    buy: 'Buyers aggressive',
    sell: 'Sellers aggressive',
    skip: '–',
  },
  {
    num: '10', name: 'OI Momentum Signals',
    param: 'Momentum Alignment',
    buy: 'Momentum + Trend same',
    sell: 'Divergence → Avoid',
    skip: 'Divergence',
  },
  {
    num: '15', name: 'Market Repositioning',
    param: 'Position Shift Bias',
    buy: 'Long buildup',
    sell: 'Short buildup',
    skip: '–',
  },
  {
    num: '16', name: 'Liquidity Intelligence',
    param: 'Trap Detection',
    buy: 'No trap + directional flow',
    sell: '–',
    skip: 'Trap detected → NO TRADE',
  },
  {
    num: '17', name: 'Institutional Market Canvas',
    param: 'Higher TF Bias',
    buy: 'HTF Bullish',
    sell: 'HTF Bearish',
    skip: '–',
  },
];

export default function MasterConfirmationCheatSheet() {
  const [open, setOpen] = useState(false);

  return (
    <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 pb-2">
      {/* Collapsed toggle bar */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-white/[0.08] bg-[#06090e] hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="w-[3px] h-4 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 shadow-[0_0_6px_2px] shadow-amber-500/30" />
          <span className="text-[11px] sm:text-xs font-black text-white/80 tracking-tight uppercase">
            Master Confirmation — 17 Section Cheat Sheet
          </span>
          <span className="hidden sm:inline text-[9px] text-white/30 font-bold">
            (10+ align → take trade)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-amber-400/70 font-bold">MANUAL CHECK</span>
          <span className="text-[10px] text-white/40">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Expanded cheat sheet */}
      {open && (
        <div className="mt-1.5 rounded-xl border border-white/[0.07] bg-[#06090e] overflow-hidden">

          {/* Rule bar */}
          <div className="px-4 py-2 bg-white/[0.02] border-b border-white/[0.05] flex flex-wrap gap-3 items-center justify-between">
            <div className="flex gap-3 flex-wrap text-[9px] font-bold">
              <span className="px-2 py-0.5 rounded-full border border-teal-500/30 text-teal-400 bg-teal-500/[0.08]">
                12+ align → STRONG TRADE
              </span>
              <span className="px-2 py-0.5 rounded-full border border-amber-500/30 text-amber-400 bg-amber-500/[0.08]">
                8–10 align → MEDIUM
              </span>
              <span className="px-2 py-0.5 rounded-full border border-rose-500/30 text-rose-400 bg-rose-500/[0.08]">
                &lt; 7 align → AVOID
              </span>
            </div>
            <span className="text-[9px] text-white/25 font-bold">
              Inst. bias + Trend + Momentum + Entry + No Trap = minimum 10/17
            </span>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[28px_1fr_1fr_1fr_1fr] gap-x-2 px-3 py-1.5 border-b border-white/[0.04] bg-black/20">
            <span />
            <span className="text-[8px] font-black text-white/30 uppercase tracking-widest"># Section</span>
            <span className="text-[8px] font-black text-white/30 uppercase tracking-widest">Key Parameter</span>
            <span className="text-[8px] font-black text-teal-400/50 uppercase tracking-widest">BUY signal</span>
            <span className="text-[8px] font-black text-rose-400/50 uppercase tracking-widest">SELL signal</span>
          </div>

          {/* Rows */}
          <div className="flex flex-col divide-y divide-white/[0.03]">
            {SECTIONS.map((s) => (
              <div
                key={s.num}
                className="grid grid-cols-[28px_1fr_1fr_1fr_1fr] gap-x-2 px-3 py-2 hover:bg-white/[0.02] transition-colors items-start"
              >
                {/* Number badge */}
                <span className="text-[9px] font-black text-white/20 tabular-nums pt-0.5">{s.num}</span>

                {/* Section name */}
                <span className="text-[10px] font-bold text-white/70 leading-tight">{s.name}</span>

                {/* Key parameter */}
                <span className="text-[9px] text-amber-300/70 font-semibold leading-tight">{s.param}</span>

                {/* BUY condition */}
                <span className="text-[9px] text-teal-300/80 font-medium leading-tight">{s.buy}</span>

                {/* SELL condition */}
                <span className="text-[9px] text-rose-300/80 font-medium leading-tight">{s.sell}</span>
              </div>
            ))}
          </div>

          {/* Skip / No-trade note */}
          <div className="px-4 py-2 border-t border-white/[0.05] bg-black/20 flex flex-wrap gap-1.5 items-center">
            <span className="text-[8px] font-black text-white/25 uppercase tracking-widest mr-1">Skip when:</span>
            {SECTIONS.filter(s => s.skip && s.skip !== '–').map(s => (
              <span key={s.num} className="text-[8px] text-white/35 font-medium">
                <span className="text-white/20">#{s.num}</span> {s.skip}
                <span className="text-white/15 mx-1">·</span>
              </span>
            ))}
          </div>

        </div>
      )}
    </div>
  );
}
