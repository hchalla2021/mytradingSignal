const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function setup() {
  let state;
  let cleanup;
  const sockets = [];
  const retries = [];
  let resolveRest;
  let rejectRest;
  const rest = new Promise((resolve, reject) => { resolveRest = resolve; rejectRest = reject; });
  class Socket {
    static OPEN = 1;
    constructor() { sockets.push(this); }
    close() { this.onclose?.(); }
  }
  const context = {
    exports: {}, AbortController, URLSearchParams, WebSocket: Socket,
    setInterval: () => 1, clearInterval() {},
    setTimeout: callback => { retries.push(callback); return 1; }, clearTimeout() {},
    fetch: () => rest,
    require: name => {
      if (name === 'react') return {
        useState: initial => {
          state = initial;
          return [state, update => { state = typeof update === 'function' ? update(state) : update; }];
        },
        useEffect: effect => { cleanup = effect(); },
      };
      if (name.endsWith('api-config')) return { API_CONFIG: {
        wsUrl: 'ws://localhost:8000/ws/market', endpoint: value => value,
      } };
      if (name.endsWith('order-flow')) return {
        isOrderFlowInterval: () => true,
        parseOrderFlow: value => value,
        mergeOrderFlowUpdate: (prior, next) => ({ ...prior, ...next }),
      };
      throw new Error(`Unexpected dependency ${name}`);
    },
  };
  vm.runInNewContext(ts.transpileModule(
    readFileSync(path.join(__dirname, '..', 'hooks', 'useOrderFlow.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText, context);
  context.exports.useOrderFlow('NIFTY', 5, 101);
  return {
    sockets, retries, resolveRest, rejectRest,
    state: () => state, cleanup: () => cleanup(),
    message: data => sockets[0].onmessage({ data: JSON.stringify({ type: 'snapshot', data }) }),
  };
}

test('stream connects before REST finishes and a late REST response cannot rewind live prices', async () => {
  const hook = setup();
  assert.equal(hook.sockets.length, 1, 'connect must not wait for REST');
  hook.message({ date: '2026-10-28', price: 105 });
  hook.resolveRest({ ok: true, json: async () => ({ date: '2026-10-28', price: 100 }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(hook.state().snapshot.price, 105);
  assert.equal(hook.state().live, true);
  hook.cleanup();
});

test('REST failure cannot downgrade a working live stream', async () => {
  const hook = setup();
  hook.message({ date: '2026-10-28', price: 105 });
  hook.rejectRest(new Error('REST timed out'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(hook.state().error, null);
  assert.equal(hook.state().live, true);
  hook.cleanup();
});

test('non-recorded expiry stays offline without reconnecting indefinitely', async () => {
  const hook = setup();
  hook.message({ available: false, recordedToken: 202 });
  hook.sockets[0].close();
  assert.equal(hook.state().live, false);
  assert.equal(hook.retries.length, 0);
  hook.resolveRest({ ok: true, json: async () => ({ available: false, recordedToken: 202 }) });
  await new Promise(resolve => setImmediate(resolve));
  hook.cleanup();
});
