# Component Integration Code Snippets

Copy & paste ready code for adding LastMarketDataCard to each analysis section.

---

## 1. CandleIntentCard Integration

**File**: `frontend/components/CandleIntentCard.tsx`

**Add import at top**:
```tsx
import LastMarketDataCard from '@/components/LastMarketDataCard';
```

**Add this in the card JSX** (near the top, after symbol title):
```tsx
{/* Last Market Data Summary */}
<div className="mb-3 pb-3 border-b border-slate-600/30">
  <LastMarketDataCard symbol={symbol} compact={true} showFullDetails={false} />
</div>
```

**Before**:
```
CandleIntentCard renders candle patterns...
```

**After**:
```
CandleIntentCard
├── Last Session Price (NIFTY: ₹19,500 ↑ +0.64%)
├── Candle patterns analysis...
└── ...
```

---

## 2. ZoneControlCard Integration

**File**: `frontend/components/ZoneControlCard.tsx`

**Add import at top**:
```tsx
import LastMarketDataCard from '@/components/LastMarketDataCard';
```

**Add this in the card JSX** (near the top of card content):
```tsx
{/* Last Market Data Reference */}
<div className="mb-4 pb-3 border-b border-slate-600/30">
  <LastMarketDataCard symbol={symbol} compact={true} />
</div>
```

**Recommended wrapper**:
```tsx
<div className="space-y-3">
  <LastMarketDataCard symbol={symbol} compact={true} />
  
  {/* Your existing zone control display follows... */}
  {/* Support/Resistance zones, breakdown risk, etc. */}
</div>
```

---

## 3. VolumePulseCard Integration

**File**: `frontend/components/VolumePulseCard.tsx`

**Add import at top**:
```tsx
import LastMarketDataCard from '@/components/LastMarketDataCard';
```

**Add this in the card JSX** (before volume ratio display):
```tsx
{/* Reference Last Session Volume */}
<div className="mb-2 pb-2 border-b border-slate-600/30">
  <LastMarketDataCard symbol={symbol} compact={true} showFullDetails={false} />
</div>
```

**Example placement**:
```tsx
<div className="bg-slate-800/40 rounded-lg p-3 border border-slate-600/30">
  <div className="text-sm font-bold text-slate-200 mb-2">Volume Pulse - {symbol}</div>
  
  <LastMarketDataCard symbol={symbol} compact={true} />
  
  {/* Volume ratio display... */}
</div>
```

---

## 4. TrendBaseCard Integration

**File**: `frontend/components/TrendBaseCard.tsx`

**Add import at top**:
```tsx
import LastMarketDataCard from '@/components/LastMarketDataCard';
```

**Add this in the card JSX** (at the beginning of trend analysis):
```tsx
{/* Market Level Reference */}
<div className="mb-3 pb-3 border-b border-slate-600/30">
  <LastMarketDataCard symbol={symbol} compact={true} />
</div>
```

**In context**:
```tsx
<div className="space-y-3">
  {/* Price Reference */}
  <LastMarketDataCard symbol={symbol} compact={true} />
  
  {/* Trend Structure */}
  <div>
    <div className="text-xs font-semibold text-slate-300 mb-2">Trend Structure</div>
    {/* Higher-high/lower-low analysis... */}
  </div>
</div>
```

---

## 5. VWMAEMAFilterCard Integration (Optional)

**File**: `frontend/components/VWMAEMAFilterCard.tsx`

**Add import at top**:
```tsx
import LastMarketDataCard from '@/components/LastMarketDataCard';
```

**Add this in the card JSX**:
```tsx
{/* Last Session Reference */}
<div className="mb-2 pb-2 border-b border-slate-600/30">
  <LastMarketDataCard symbol={symbol} compact={true} showFullDetails={false} />
</div>
```

---

## 6. PivotSectionUnified (Already Has It ✅)

This component already displays full pivot analysis with last-session data.
No changes needed - it's a reference implementation.

---

## Complete Example: Adding to CandleIntentCard

### Before:
```tsx
export default function CandleIntentCard({ symbol }: { symbol: string }) {
  return (
    <div className="bg-dark-card rounded-lg p-3 border border-slate-600/30">
      <div className="text-sm font-bold text-slate-200 mb-2">{symbol}</div>
      
      {/* Candle analysis logic... */}
    </div>
  );
}
```

### After:
```tsx
import LastMarketDataCard from '@/components/LastMarketDataCard';

export default function CandleIntentCard({ symbol }: { symbol: string }) {
  return (
    <div className="bg-dark-card rounded-lg p-3 border border-slate-600/30">
      <div className="text-sm font-bold text-slate-200 mb-2">{symbol}</div>
      
      {/* Add this new section */}
      <div className="mb-3 pb-3 border-b border-slate-600/30">
        <LastMarketDataCard symbol={symbol as 'NIFTY' | 'BANKNIFTY' | 'SENSEX'} compact={true} />
      </div>
      
      {/* Existing candle analysis logic... */}
    </div>
  );
}
```

---

## TypeScript Type Hints

If you get TypeScript errors for the `symbol` prop, use this guard:

```tsx
<LastMarketDataCard 
  symbol={symbol as 'NIFTY' | 'BANKNIFTY' | 'SENSEX'} 
  compact={true} 
/>
```

Or properly type your component:

```tsx
interface CardProps {
  symbol: 'NIFTY' | 'BANKNIFTY' | 'SENSEX';
}

export default function MyCard({ symbol }: CardProps) {
  return (
    <LastMarketDataCard symbol={symbol} compact={true} />
  );
}
```

---

## Styling Wrapper Patterns

### Pattern 1: Border Separator
```tsx
<div className="mb-3 pb-3 border-b border-slate-600/30">
  <LastMarketDataCard symbol={symbol} compact={true} />
</div>
```

### Pattern 2: Background Box
```tsx
<div className="mb-3 p-2 bg-slate-700/20 rounded border border-slate-600/20">
  <LastMarketDataCard symbol={symbol} compact={true} />
</div>
```

### Pattern 3: Minimal (No wrapper)
```tsx
<div className="mb-2">
  <LastMarketDataCard symbol={symbol} compact={true} />
</div>
```

### Pattern 4: Grid Layout
```tsx
<div className="grid grid-cols-3 gap-2 mb-3">
  <LastMarketDataCard symbol="NIFTY" compact={true} />
  <LastMarketDataCard symbol="BANKNIFTY" compact={true} />
  <LastMarketDataCard symbol="SENSEX" compact={true} />
</div>
```

---

## Responsive Adjustments

### Mobile Optimized:
```tsx
<div className="hidden sm:block mb-3 pb-3 border-b border-slate-600/30">
  <LastMarketDataCard symbol={symbol} compact={true} />
</div>
```

### Desktop Only:
```tsx
<div className="hidden md:block mb-3 pb-3 border-b border-slate-600/30">
  <LastMarketDataCard symbol={symbol} compact={true} />
</div>
```

### Always Show:
```tsx
<div className="mb-3 pb-3 border-b border-slate-600/30">
  <LastMarketDataCard symbol={symbol} compact={true} />
</div>
```

---

## Implementation Checklist

- [ ] Open `CandleIntentCard.tsx`
- [ ] Add import: `import LastMarketDataCard from '@/components/LastMarketDataCard';`
- [ ] Add component to JSX
- [ ] Save and verify in browser
- [ ] Repeat for ZoneControlCard
- [ ] Repeat for VolumePulseCard
- [ ] Repeat for TrendBaseCard
- [ ] Test on mobile, tablet, desktop
- [ ] Verify all 3 indices display correctly

---

## Quick Copy-Paste Bundle

**For CandleIntentCard**:
```tsx
// Add after other imports
import LastMarketDataCard from '@/components/LastMarketDataCard';

// Inside component JSX, after title:
<div className="mb-3 pb-3 border-b border-slate-600/30">
  <LastMarketDataCard symbol={symbol as 'NIFTY' | 'BANKNIFTY' | 'SENSEX'} compact={true} />
</div>
```

**For ZoneControlCard**:
```tsx
import LastMarketDataCard from '@/components/LastMarketDataCard';

// Inside component JSX, at top of content:
<div className="mb-4 pb-3 border-b border-slate-600/30">
  <LastMarketDataCard symbol={symbol as 'NIFTY' | 'BANKNIFTY' | 'SENSEX'} compact={true} />
</div>
```

**For VolumePulseCard**:
```tsx
import LastMarketDataCard from '@/components/LastMarketDataCard';

// Inside component JSX, before volume display:
<div className="mb-2 pb-2 border-b border-slate-600/30">
  <LastMarketDataCard symbol={symbol as 'NIFTY' | 'BANKNIFTY' | 'SENSEX'} compact={true} showFullDetails={false} />
</div>
```

**For TrendBaseCard**:
```tsx
import LastMarketDataCard from '@/components/LastMarketDataCard';

// Inside component JSX, before trend analysis:
<div className="mb-3 pb-3 border-b border-slate-600/30">
  <LastMarketDataCard symbol={symbol as 'NIFTY' | 'BANKNIFTY' | 'SENSEX'} compact={true} />
</div>
```

---

## Next: Testing

Once you've added the imports and components:

1. **Browser Refresh**: Hard refresh (Ctrl+Shift+R)
2. **Check Page**: http://localhost:3000
3. **Verify Display**: Each card should show market data in compact format
4. **Test Refresh**: Wait 30 seconds, data should update automatically
5. **Network Tab**: Should see API calls to `/api/advanced/pivot-indicators/last-session`

---

## Questions?

- **Where is LastMarketDataBanner already added?** 
  - Answer: `frontend/app/page.tsx` line 105 (below LiveStatus)
  
- **Do I need the full details or compact?** 
  - Answer: Use `compact={true}` for cards, `compact={false}` for dedicated pages

- **What if symbol is passed as string?** 
  - Answer: Use `symbol as 'NIFTY' | 'BANKNIFTY' | 'SENSEX'` for type safety

- **How often does data refresh?** 
  - Answer: Every 30 seconds automatically

- **What if API fails?** 
  - Answer: Falls back to backend's `market_backup.json`
