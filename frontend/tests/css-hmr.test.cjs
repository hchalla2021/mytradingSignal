const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const transform = require('../build-tools/css-hmr-loader.cjs');
const config = require('../next.config.js');

const runtimePath = require.resolve('next/dist/compiled/mini-css-extract-plugin/hmr/hotModuleReplacement.js');
const source = readFileSync(runtimePath, 'utf8');

function fixture(runtimeSource) {
  const events = {};
  let attached = true;
  let removalCount = 0;
  let replacement;
  const parent = {
    removeChild(link) {
      assert.equal(link, original);
      assert.equal(attached, true);
      attached = false;
      removalCount++;
    },
    appendChild(link) { replacement = link; },
  };
  const original = {
    href: 'http://localhost:3000/chart.css',
    get parentNode() { return attached ? parent : null; },
    remove() { if (attached) parent.removeChild(this); },
    cloneNode() {
      return {
        addEventListener(event, callback) { events[event] = callback; },
      };
    },
  };
  let pending;
  const context = {
    __dirname,
    module: { exports: {} },
    document: {
      currentScript: { src: 'http://localhost:3000/chart.js' },
      querySelectorAll: () => [original],
    },
    setTimeout(callback) { pending = callback; return 1; },
    clearTimeout() {},
    console: { log() {} },
  };
  vm.runInNewContext(runtimeSource, context);
  const reload = context.module.exports('chart', { locals: true });
  reload();
  pending();
  assert.ok(replacement, 'Replacement stylesheet must be inserted');
  return {
    events,
    detach() { attached = false; },
    removalCount: () => removalCount,
  };
}

test('reproduces upstream CSS HMR detached-link failure', () => {
  const hmr = fixture(source);
  hmr.detach();
  assert.throws(() => hmr.events.load(), /removeChild/);
});

test('patched load and error callbacks tolerate a stylesheet removed by navigation', () => {
  for (const event of ['load', 'error']) {
    const hmr = fixture(transform(source));
    hmr.detach();
    assert.doesNotThrow(() => hmr.events[event]());
    assert.equal(hmr.removalCount(), 0);
  }
});

test('attached stylesheet still gets replaced once, including duplicate callbacks', () => {
  for (const event of ['load', 'error']) {
    const hmr = fixture(transform(source));
    hmr.events[event]();
    hmr.events.load();
    hmr.events.error();
    assert.equal(hmr.removalCount(), 1);
  }
});

test('compatibility transform fails explicitly if the upstream runtime changes', () => {
  assert.throws(() => transform('unrecognized source'), /runtime changed/);
});

test('webpack applies compatibility loader only to development CSS HMR', () => {
  const development = config.webpack({ module: { rules: [] } }, { dev: true });
  assert.equal(development.cache, false);
  assert.equal(development.module.rules.length, 1);
  assert.equal(development.module.rules[0].test, runtimePath);
  assert.equal(development.module.rules[0].enforce, 'pre');
  const production = config.webpack({ module: { rules: [] } }, { dev: false });
  assert.equal(production.module.rules.length, 0);
  assert.notEqual(config.eslint?.ignoreDuringBuilds, true);
});
