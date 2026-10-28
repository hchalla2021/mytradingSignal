const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

test('live stream rejects older candles and keeps one retry chain that stops on unmount', () => {
  const states = [];
  const frames = [];
  const timers = new Map();
  let nextTimer = 0;
  const sockets = [];
  let socket;
  let cleanup;
  class Socket {
    static OPEN = 1;
    static CONNECTING = 0;
    constructor() { socket = this; this.readyState = 0; sockets.push(this); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const context = {
    exports: {}, process: { env: {} }, console, WebSocket: Socket,
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    setInterval: () => 1, clearTimeout: id => timers.delete(id), clearInterval() {},
    fetch: () => new Promise(() => {}),
    AbortSignal, structuredClone,
    localStorage: { getItem: () => null, setItem() {} },
    window: {
      location: { hostname: 'localhost' },
      requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
      cancelAnimationFrame() {},
    },
    require: name => {
      if (name === 'react') return {
        useState: initial => {
          const index = states.length;
          states.push(typeof initial === 'function' ? initial() : initial);
          return [states[index], update => {
            states[index] = typeof update === 'function' ? update(states[index]) : update;
          }];
        },
        useRef: current => ({ current }),
        useCallback: callback => callback,
        useEffect: effect => { cleanup = effect(); },
      };
      return { getEnvironmentConfig: () => ({
        wsUrl: 'ws://localhost:8000/ws/market', apiUrl: 'http://localhost:8000',
      }) };
    },
  };
  vm.runInNewContext(ts.transpileModule(
    readFileSync(path.join(__dirname, '..', 'hooks', 'useChartIntelligence.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText, context);
  context.exports.useChartIntelligence();
  const send = (second, price) => socket.onmessage({ data: JSON.stringify({
    type: 'chart_intel_update',
    data: { NIFTY: {
      timestamp: `2026-10-28T10:00:0${second}+05:30`, dataSource: 'LIVE', spot: price,
      candles3m: [], candles5m: [],
    } },
  }) });
  send(2, 102);
  send(1, 101);
  frames.shift()();
  assert.equal(states[0].NIFTY.spot, 102, 'older payload cannot replace the queued newer frame');
  send(1, 101);
  frames.shift()();
  assert.equal(states[0].NIFTY.spot, 102, 'older LIVE payload cannot overwrite rendered data');
  send(3, 103);
  frames.shift()();
  assert.equal(states[0].NIFTY.spot, 103, 'newer ticks still move the candle');
  const connectTimeout = [...timers.values()][0];
  connectTimeout();
  assert.equal(sockets.length, 1, 'timeout must not start a parallel socket');
  assert.equal(timers.size, 1, 'only one reconnect is scheduled after timeout');
  const retry = [...timers.values()][0];
  cleanup();
  retry();
  assert.equal(sockets.length, 1, 'an unmounted hook must never reconnect');
});
