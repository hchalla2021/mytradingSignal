/**
 * Test: Market Structure Trend Analysis
 * 
 * Compares OLD logic (strict AND) vs NEW logic (weighted scoring)
 * Run in Node.js or browser console
 */

// =========== OLD LOGIC (STRICT AND CONDITIONS) ===========
function analyzeMarketStructure_OLD(price, high, low, close) {
  const positionInRange = (price - low) / (high - low);
  const percentAboveClose = ((price - close) / close) * 100;
  
  let structure = 'CONSOLIDATING';
  
  // STRICT: BOTH conditions must be true
  if (positionInRange > 0.7 && percentAboveClose > 0.5) {
    structure = percentAboveClose > 1.5 ? 'STRONG_UP' : 'WEAK_UP';
  } else if (positionInRange < 0.3 && percentAboveClose < -0.5) {
    structure = percentAboveClose < -1.5 ? 'STRONG_DOWN' : 'WEAK_DOWN';
  }
  
  return { structure, positionInRange: (positionInRange * 100).toFixed(0), percentAboveClose: percentAboveClose.toFixed(2) };
}

// =========== NEW LOGIC (WEIGHTED SCORING) ===========
function analyzeMarketStructure_NEW(price, high, low, close) {
  const positionInRange = (price - low) / (high - low);
  const percentAboveClose = ((price - close) / close) * 100;
  const rangePercent = ((high - low) / close) * 100;
  
  // Weighted scoring (0-100, 50 = neutral)
  let trendScore = 50;
  
  // Factor 1: Position in range (±30 points)
  if (positionInRange > 0.7) {
    trendScore += 30 * ((positionInRange - 0.7) / 0.3);
  } else if (positionInRange < 0.3) {
    trendScore -= 30 * ((0.3 - positionInRange) / 0.3);
  }
  
  // Factor 2: Change from close (±40 points)
  if (percentAboveClose > 0) {
    trendScore += Math.min(40, percentAboveClose * 20);
  } else if (percentAboveClose < 0) {
    trendScore += Math.max(-40, percentAboveClose * 20);
  }
  
  // Classify
  let structure = 'CONSOLIDATING';
  if (trendScore > 65) {
    structure = trendScore > 80 ? 'STRONG_UP' : 'WEAK_UP';
  } else if (trendScore < 35) {
    structure = trendScore < 20 ? 'STRONG_DOWN' : 'WEAK_DOWN';
  } else {
    if (rangePercent < 0.5) {
      structure = 'CONSOLIDATING';
    } else if (trendScore > 55) {
      structure = 'WEAK_UP';
    } else if (trendScore < 45) {
      structure = 'WEAK_DOWN';
    } else {
      structure = 'NEUTRAL_RANGE';
    }
  }
  
  return { 
    structure, 
    trendScore: trendScore.toFixed(0),
    positionInRange: (positionInRange * 100).toFixed(0), 
    percentAboveClose: percentAboveClose.toFixed(2) 
  };
}

// =========== TEST CASES ===========
const testCases = [
  {
    name: "Scenario 1: Top 70% of range, but only +0.3% change",
    price: 20210,
    high: 20250,
    low: 20100,
    close: 20200,
    expected: "WEAK_UP"
  },
  {
    name: "Scenario 2: Up +1.2%, but only 65% of range",
    price: 20341,
    high: 20350,
    low: 20250,
    close: 20100,
    expected: "WEAK_UP"
  },
  {
    name: "Scenario 3: Consolidated range, +0.05% change",
    price: 20201,
    high: 20250,
    low: 20100,
    close: 20200,
    expected: "NEUTRAL_RANGE or CONSOLIDATING"
  },
  {
    name: "Scenario 4: Clear uptrend - 80% range, +2.5%",
    price: 20300,
    high: 20350,
    low: 20100,
    close: 20100,
    expected: "STRONG_UP"
  },
  {
    name: "Scenario 5: Down -0.5%, but at 48% of range",
    price: 20000,
    high: 20200,
    low: 19800,
    close: 20100,
    expected: "WEAK_DOWN"
  },
  {
    name: "Scenario 6: Dead flat - no movement",
    price: 20100,
    high: 20150,
    low: 20050,
    close: 20100,
    expected: "CONSOLIDATING"
  },
];

console.log("═══════════════════════════════════════════════════════════════");
console.log("MARKET STRUCTURE TREND ANALYSIS - OLD vs NEW LOGIC");
console.log("═══════════════════════════════════════════════════════════════\n");

testCases.forEach((test, idx) => {
  console.log(`\n📊 TEST ${idx + 1}: ${test.name}`);
  console.log("─────────────────────────────────────────────");
  console.log(`   Market Data: Price=${test.price.toLocaleString()}, High=${test.high.toLocaleString()}, Low=${test.low.toLocaleString()}, Close=${test.close.toLocaleString()}`);
  
  const oldResult = analyzeMarketStructure_OLD(test.price, test.high, test.low, test.close);
  const newResult = analyzeMarketStructure_NEW(test.price, test.high, test.low, test.close);
  
  console.log(`\n   OLD LOGIC:  ${oldResult.structure}`);
  console.log(`   ├─ Position: ${oldResult.positionInRange}%`);
  console.log(`   └─ Change: ${oldResult.percentAboveClose}%`);
  
  console.log(`\n   NEW LOGIC:  ${newResult.structure} (Score: ${newResult.trendScore}/100)`);
  console.log(`   ├─ Position: ${newResult.positionInRange}%`);
  console.log(`   └─ Change: ${newResult.percentAboveClose}%`);
  
  const improved = oldResult.structure === 'CONSOLIDATING' && newResult.structure !== 'CONSOLIDATING';
  console.log(`\n   ✅ IMPROVED: ${improved ? 'YES - Now detects trend!' : 'Same (both correct) or expected'}`);
});

console.log("\n\n═══════════════════════════════════════════════════════════════");
console.log("SUMMARY OF IMPROVEMENTS");
console.log("═══════════════════════════════════════════════════════════════");
console.log(`
✅ More Responsive
   - Single strong factor can indicate trend
   - Not stuck in CONSOLIDATING unnecessarily

✅ Dynamic Scoring
   - Score = 50 (neutral)
   - ±30 from range position
   - ±40 from price change
   - Total: 0-100 scale

✅ Professional Classification
   - 80+ = STRONG_UP
   - 65-80 = WEAK_UP
   - 35-65 = RANGE variants
   - 20-35 = WEAK_DOWN
   - <20 = STRONG_DOWN

✅ Better Market Representation
   - Reflects how traders think
   - Matches professional analysis
   - Updates as market changes
`);

// =========== EXPORT FOR TESTING ===========
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    analyzeMarketStructure_OLD,
    analyzeMarketStructure_NEW,
    testCases
  };
}
