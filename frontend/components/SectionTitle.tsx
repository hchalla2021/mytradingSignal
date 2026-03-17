'use client';

import React, { memo } from 'react';

interface SectionTitleProps {
  title: string;
  subtitle?: string;
  accentColor?: 'emerald' | 'purple' | 'green' | 'teal' | 'cyan' | 'amber' | 'blue' | 'red';
  badge?: React.ReactNode;
  rightContent?: React.ReactNode;
}

const accentMap: Record<string, { bar: string; glow: string; line: string; text: string; bg: string }> = {
  emerald:  { bar: 'from-emerald-400 to-emerald-600', glow: 'shadow-emerald-500/20', line: 'via-emerald-500/30', text: 'text-emerald-400', bg: 'bg-emerald-500/[0.06]' },
  purple:   { bar: 'from-purple-400 to-purple-600',   glow: 'shadow-purple-500/20',  line: 'via-purple-500/30',  text: 'text-purple-400',  bg: 'bg-purple-500/[0.06]' },
  green:    { bar: 'from-green-400 to-green-600',     glow: 'shadow-green-500/20',   line: 'via-green-500/30',   text: 'text-green-400',   bg: 'bg-green-500/[0.06]' },
  teal:     { bar: 'from-teal-400 to-teal-600',       glow: 'shadow-teal-500/20',    line: 'via-teal-500/30',    text: 'text-teal-400',    bg: 'bg-teal-500/[0.06]' },
  cyan:     { bar: 'from-cyan-400 to-cyan-600',       glow: 'shadow-cyan-500/20',    line: 'via-cyan-500/30',    text: 'text-cyan-400',    bg: 'bg-cyan-500/[0.06]' },
  amber:    { bar: 'from-amber-400 to-amber-600',     glow: 'shadow-amber-500/20',   line: 'via-amber-500/30',   text: 'text-amber-400',   bg: 'bg-amber-500/[0.06]' },
  blue:     { bar: 'from-blue-400 to-blue-600',       glow: 'shadow-blue-500/20',    line: 'via-blue-500/30',    text: 'text-blue-400',    bg: 'bg-blue-500/[0.06]' },
  red:      { bar: 'from-red-400 to-red-600',         glow: 'shadow-red-500/20',     line: 'via-red-500/30',     text: 'text-red-400',     bg: 'bg-red-500/[0.06]' },
};

const SectionTitle = memo<SectionTitleProps>(({ title, subtitle, accentColor = 'emerald', badge, rightContent }) => {
  const accent = accentMap[accentColor] || accentMap.emerald;

  return (
    <div className="mb-4 sm:mb-5">
      {/* Heading block */}
      <div className={`relative rounded-xl ${accent.bg} border border-emerald-400/25 px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm ${accent.glow}`}>
        {/* Top edge highlight */}
        <div className={`absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent ${accent.line} to-transparent`} />

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 overflow-hidden">
            {/* Accent bar */}
            <span className={`w-[3px] h-7 sm:h-9 rounded-full bg-gradient-to-b ${accent.bar} shrink-0 shadow-sm ${accent.glow}`} />
            {/* Title */}
            <h2 className="text-[14px] sm:text-[18px] lg:text-[22px] font-extrabold text-white tracking-tight leading-snug truncate">
              {title}
            </h2>
            {badge && <span className="shrink-0">{badge}</span>}
          </div>
          {rightContent && <div className="shrink-0">{rightContent}</div>}
        </div>

        {/* Subtitle */}
        {subtitle && (
          <p className={`text-[11px] sm:text-xs ${accent.text} opacity-60 mt-1.5 ml-[15px] sm:ml-[17px] font-medium tracking-wide leading-relaxed`}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
});

SectionTitle.displayName = 'SectionTitle';

export { SectionTitle };
export default SectionTitle;
