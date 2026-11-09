// ─── Q0390: a route change drops Node's own fetch pool, not just web3's Connection objects ───
// web3.js uses the built-in fetch, whose sockets live in one global pool. After a switch with the kill
// switch held, getSlot reused sockets from the old tunnel route and timed out (Azure deb12, TLX2 10-30).
import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { resetRpcTransport } from '../../src/core/chain/rpc';

const open = new Map<number, { closed: boolean }>(); // client port -> state, seen from the server side
const used: number[] = [];
const server = http.createServer((req, res) => {
  used.push(req.socket.remotePort as number);
  const ms = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('delay') ?? 0);
  setTimeout(() => res.end('ok'), ms);
});
server.keepAliveTimeout = 60_000;
server.on('connection', (s: Socket) => { const rec = { closed: false }; open.set(s.remotePort as number, rec); s.on('close', () => { rec.closed = true; }); });
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
const get = async (): Promise<void> => { await (await fetch(url)).text(); };
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('resetRpcTransport drops the fetch pool (Q0390)', () => {
  const before: number[] = [];

  it('control: without a reset the pool reuses its sockets', async () => {
    for (let i = 0; i < 4; i++) await get();
    before.push(...open.keys());
    expect(new Set(used).size).toBeLessThan(used.length); // at least one socket served twice
    expect([...open.values()].every((s) => !s.closed)).toBe(true);
  });

  it('after a reset the next call uses a new socket, and the old ones close after the grace', async () => {
    resetRpcTransport();
    await get();
    expect(before).not.toContain(used.at(-1)); // nothing can reuse the old route
    const { FETCH_POOL_GRACE_MS } = await import('../../src/core/chain/rpc');
    await settle(FETCH_POOL_GRACE_MS + 300);
    expect(before.every((p) => open.get(p)?.closed)).toBe(true);
  }, 10_000);

  // QA 10-30 (Mac app, switch AWG→WG): the old session's end reset the transport while the switch's
  // own chain call was in flight; destroying the pool aborted it. A call already on the wire finishes.
  it('a call in flight when the route changes still gets its answer', async () => {
    const inFlight = fetch(`${url}?delay=400`).then((r) => r.text());
    await settle(50);
    resetRpcTransport();
    await expect(inFlight).resolves.toBe('ok');
  });

  it('a call still stuck on the old route after the grace is cut', async () => {
    const { dropFetchPool } = await import('../../src/core/chain/rpc');
    const stuck = fetch(`${url}?delay=5000`).then((r) => r.text());
    await settle(50);
    expect(dropFetchPool(200)).toBe(true);
    await expect(stuck).rejects.toThrow();
  });
});
