const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function compile(filename) {
  const source = readFileSync(path.join(__dirname, '..', 'components', filename), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
}

function harness(filename = 'LiveMarketIndexTabs.tsx') {
  let selected = 'NIFTY';
  let focused;
  const context = {
    exports: {},
    document: { getElementById: id => ({ focus: () => { focused = id; } }) },
    require: name => {
      if (name === 'react') {
        return {
          useState: initial => initial === 'NIFTY'
            ? [selected, value => { selected = value; }] : [initial, () => {}],
          useRef: value => ({ current: value }),
          useEffect: () => {},
          useMemo: factory => factory(),
          memo: component => component,
        };
      }
      if (name === 'next/dynamic') return () => function IndexCard() {};
      if (name === '@/components/IndexTabs') return IndexTabs;
      if (name === '@/lib/buyerIntelligence') return {};
      if (name === '@/hooks/useStrikeIntelligence') {
        return { useStrikeIntelligence: () => ({
          strikeData: props.marketData, isConnected: props.isConnected, lastUpdate: null,
        }) };
      }
      if (name === '@/hooks/useSMCStructure') {
        return { useSMCStructure: () => ({
          data: props.marketData, isConnected: props.isConnected, lastUpdate: null,
        }) };
      }
      if (name === '@/hooks/useTradingIntelligence') {
        return { useTradingIntelligence: () => ({
          data: props.marketData, isConnected: props.isConnected, lastUpdate: null,
        }) };
      }
      if (name === 'react/jsx-runtime') return require(name);
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(compile('IndexTabs.tsx'), context);
  const IndexTabs = context.exports.default;
  const IndexTabList = context.exports.IndexTabList;
  const componentContext = { ...context, exports: {} };
  vm.runInNewContext(compile(filename), componentContext);
  const props = {
    marketData: { NIFTY: { price: 25000 }, BANKNIFTY: { price: 55000 }, SENSEX: null },
    isConnected: true,
    alertData: { BANKNIFTY: { showAlert: true } },
  };
  const render = () => {
    const elements = [];
    const walk = element => {
      if (!element || typeof element !== 'object') return;
      if (element.type === IndexTabs) {
        walk(IndexTabs(element.props));
        return;
      }
      if (element.type === IndexTabList) {
        walk(IndexTabList(element.props));
        return;
      }
      elements.push(element);
      const children = element.props?.children;
      for (const child of [children].flat(Infinity)) walk(child);
    };
    walk(componentContext.exports.default(props));
    return {
      tabs: elements.filter(element => element.props.role === 'tab'),
      panels: elements.filter(element => element.props.role === 'tabpanel'),
    };
  };
  return { render, props, focused: () => focused };
}

test('defaults to NIFTY and exposes one visible panel with accessible tab relationships', () => {
  const { render } = harness();
  const { tabs, panels } = render();
  assert.deepEqual(tabs.map(tab => tab.props['aria-label']), ['NIFTY', 'BANKNIFTY', 'SENSEX']);
  assert.equal(panels.filter(panel => !panel.props.hidden).length, 1);
  assert.equal(panels[0].props.hidden, false);
  tabs.forEach((tab, index) => {
    assert.equal(tab.props['aria-controls'], panels[index].props.id);
    assert.equal(panels[index].props['aria-labelledby'], tab.props.id);
    assert.equal(tab.props['aria-selected'], index === 0);
    assert.equal(tab.props.tabIndex, index === 0 ? 0 : -1);
  });
});

test('clicking each tab shows only its card while all cards retain their live props and keys', () => {
  const { render, props } = harness();
  for (let index = 0; index < 3; index++) {
    render().tabs[index].props.onClick();
    const { tabs, panels } = render();
    assert.deepEqual(panels.map(panel => panel.props.hidden), [0, 1, 2].map(i => i !== index));
    assert.equal(tabs[index].props['aria-selected'], true);
    assert.equal(panels.length, 3);
    panels.forEach(panel => {
      const card = panel.props.children;
      assert.equal(panel.key, card.props.symbol);
      assert.equal(card.props.data, props.marketData[card.props.symbol]);
      assert.equal(card.props.aiAlertData, props.alertData[card.props.symbol]);
      assert.equal(card.props.isConnected, true);
    });
  }
  props.marketData.NIFTY = { price: 25050 };
  props.isConnected = false;
  const hiddenCard = render().panels[0];
  assert.equal(hiddenCard.props.hidden, true);
  assert.equal(hiddenCard.props.children.props.data.price, 25050);
  assert.equal(hiddenCard.props.children.props.isConnected, false);
});

test('keyboard navigation wraps, supports Home/End, and moves focus to the selected tab', () => {
  const { render, focused } = harness();
  for (const [key, expected] of [
    ['ArrowLeft', 2], ['ArrowRight', 0], ['End', 2], ['Home', 0], ['ArrowRight', 1],
  ]) {
    let prevented = false;
    const active = render().tabs.find(tab => tab.props['aria-selected']);
    active.props.onKeyDown({ key, preventDefault: () => { prevented = true; } });
    const next = render().tabs[expected];
    assert.equal(prevented, true);
    assert.equal(next.props['aria-selected'], true);
    assert.equal(focused(), next.props.id);
  }
  render().tabs[1].props.onKeyDown({
    key: 'Tab',
    preventDefault: () => assert.fail('Tab must retain its normal browser behavior'),
  });
  assert.equal(render().tabs[1].props['aria-selected'], true);
});

test('AI Signal Deck uses independent accessible tabs and retains all live signal cards', () => {
  const live = harness();
  const ai = harness('TopAISignalBar.tsx');
  const initial = ai.render();
  assert.equal(initial.tabs[0].props['aria-selected'], true);
  assert.equal(initial.panels.filter(panel => !panel.props.hidden).length, 1);
  initial.tabs.forEach((tab, index) => {
    assert.equal(tab.props.id, `ai-signal-tab-${tab.props['aria-label']}`);
    assert.equal(tab.props['aria-controls'], initial.panels[index].props.id);
    assert.notEqual(tab.props.id, live.render().tabs[index].props.id);
  });
  initial.tabs[2].props.onClick();
  assert.equal(ai.render().panels[2].props.hidden, false);
  assert.equal(live.render().panels[0].props.hidden, false);
  ai.props.marketData.NIFTY = { price: 25100 };
  ai.render().panels.forEach(panel => {
    const card = panel.props.children;
    assert.equal(card.props.tick, ai.props.marketData[card.props.indexKey]);
    assert.equal(panel.key, card.props.indexKey);
  });
  let prevented = false;
  ai.render().tabs[2].props.onKeyDown({ key: 'ArrowRight', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(ai.focused(), 'ai-signal-tab-NIFTY');
  assert.equal(ai.render().panels[0].props.hidden, false);
});

test('Strike Intelligence tabs preserve per-index cards, live data, and independent selection', () => {
  const strike = harness('StrikeIntelligence.tsx');
  const ai = harness('TopAISignalBar.tsx');
  const initial = strike.render();
  assert.equal(initial.panels.filter(panel => !panel.props.hidden).length, 1);
  assert.equal(initial.panels[0].props.hidden, false);
  for (let index = 0; index < 3; index++) {
    strike.render().tabs[index].props.onClick();
    const { tabs, panels } = strike.render();
    assert.equal(panels.filter(panel => !panel.props.hidden).length, 1);
    assert.equal(panels[index].props.hidden, false);
    tabs.forEach((tab, i) => {
      const symbol = tab.props['aria-label'];
      assert.equal(tab.props.id, `strike-intelligence-tab-${symbol}`);
      assert.equal(tab.props['aria-controls'], panels[i].props.id);
      assert.equal(panels[i].props['aria-labelledby'], tab.props.id);
      assert.equal(panels[i].props.children.props.data, strike.props.marketData[symbol]);
      assert.equal(panels[i].key, symbol);
    });
  }
  assert.equal(ai.render().panels[0].props.hidden, false);
  strike.props.marketData.NIFTY = { price: 25200 };
  const hiddenPanel = strike.render().panels[0];
  assert.equal(hiddenPanel.props.hidden, true);
  assert.equal(hiddenPanel.props.children.props.data.price, 25200);
  strike.render().tabs[2].props.onKeyDown({ key: 'Home', preventDefault: () => {} });
  assert.equal(strike.focused(), 'strike-intelligence-tab-NIFTY');
  assert.equal(strike.render().panels[0].props.hidden, false);
});

for (const [filename, prefix, prop] of [
      ['SMCStructureSection.tsx', 'smc-structure', 'row'],
      ['TradingIntelligenceEngine.tsx', 'greeks-overview', 'ai'],
    ]) {
      test(`${prefix} shows one index, preserves keyed panels and updates hidden cards`, () => {
        const h = harness(filename);
        const other = harness();
        for (let index = 0; index < 3; index++) {
          h.render().tabs[index].props.onClick();
          const { tabs, panels } = h.render();
          assert.equal(panels.filter(panel => !panel.props.hidden).length, 1);
          assert.equal(panels[index].props.hidden, false);
          tabs.forEach((tab, i) => {
            const symbol = tab.props['aria-label'];
            assert.equal(tab.props.id, `${prefix}-tab-${symbol}`);
            assert.equal(tab.props['aria-controls'], panels[i].props.id);
            assert.equal(panels[i].props['aria-labelledby'], tab.props.id);
            assert.equal(panels[i].key, symbol);
            if (h.props.marketData[symbol]) {
              assert.equal(panels[i].props.children.props[prop], h.props.marketData[symbol]);
            }
          });
        }
        assert.equal(other.render().panels[0].props.hidden, false);
        h.props.marketData.NIFTY = { price: 25300 };
        assert.equal(h.render().panels[0].props.children.props[prop].price, 25300);
        h.render().tabs[2].props.onKeyDown({ key: 'ArrowRight', preventDefault: () => {} });
        assert.equal(h.focused(), `${prefix}-tab-NIFTY`);
        assert.equal(h.render().panels[0].props.hidden, false);
      });
    }

    test('SMC keeps missing indices selectable and shows their own building-data status', () => {
      const h = harness('SMCStructureSection.tsx');
      h.render().tabs[2].props.onClick();
      const panel = h.render().panels[2];
      assert.equal(panel.props.hidden, false);
      assert.equal(panel.props.children.props.role, 'status');
      assert.ok(panel.props.children.props.children.includes('SENSEX'));
      h.props.marketData.SENSEX = { price: 82000 };
      assert.equal(h.render().panels[2].props.children.props.row.price, 82000);
    });
