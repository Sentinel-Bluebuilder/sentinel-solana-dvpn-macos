// ─── Restore network is never offered while dvpnd may be redialing (Q0373) ───
// TWD (Windows, Q0366 cut): dvpnd was redialing (kill switch holding, internet blocked) and one
// ListSessions call dropped. The app took that as "no session", the internet check failed (the
// block) and it offered Restore network, which drops the block mid-redial. A failed read on a
// running daemon is "unknown"; only a daemon that is not running proves no session.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  list: (async () => []) as () => Promise<unknown[]>,
  reachable: true,
  state: { session: null as unknown, conn: { phase: 'idle', title: 'Not connected' } as Record<string, unknown> },
}));
vi.mock('../../src/main/host', () => ({ getHost: () => ({ dataDir: '.' }) }));
vi.mock('../../src/main/app-state', () => ({
  snapshot: () => st.state,
  patch: (p: Record<string, unknown>) => { Object.assign(st.state, p); },
  setSplitInEffect: vi.fn(),
  setWholeDeviceInEffect: vi.fn(), // macOS: the adopt path sets it
  toast: vi.fn(),
}));
vi.mock('../../src/main/daemon/manager', () => {
  const d = new Proxy({}, { get: (_t, k) => (k === 'listSessions' ? () => st.list() : async () => null) });
  return {
    daemon: () => { if (!st.reachable) throw new Error('The VPN service is not running.'); return d; },
    daemonInfo: () => ({ reachable: st.reachable, device: 'Dev', networkOk: true }),
  };
});
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/system/tunnels', () => ({ leftoverTunnels: async () => [], rivalVpns: async () => [], removeTunnelServices: async () => undefined }));
vi.mock('../../src/core/quality/reachability', () => ({ internetReachable: async () => false }));
vi.mock('../../src/core/chain/rpc', () => ({ getRpcUrls: () => [], resetRpcTransport: vi.fn(), onRpcRetry: () => () => undefined }));

const { checkLeftoverBlock, adoptRunningSession, sessionStateUnknown } = await import('../../src/main/services/connection');

describe('Restore network during a redial (Q0373)', () => {
  beforeEach(() => {
    st.state.session = null;
    st.state.conn = { phase: 'idle', title: 'Not connected' };
    st.reachable = true;
  });

  it('a running dvpnd whose ListSessions drops: unknown, no Restore network', async () => {
    st.list = async () => { throw new Error('Connection dropped'); };
    await adoptRunningSession();
    expect(sessionStateUnknown()).toBe(true);
    expect(await checkLeftoverBlock()).toBe(false);
    expect(st.state.conn.restoreNetwork).toBeFalsy();
  });

  it('a running dvpnd that answers with a reconnecting session: adopted, no Restore network', async () => {
    st.list = async () => [{ id: 's1', node: 'N', service: 'wireguard', status: 'active', error: 'connection lost; reconnecting', channel: '', rxBytes: '0', txBytes: '0', spent: '0' }];
    expect(await checkLeftoverBlock()).toBe(false);
    expect(st.state.conn.restoreNetwork).toBeFalsy();
    expect(st.state.conn.phase).toBe('reconnecting');
  });

  // Q0366 pass 2 (1): during a redial dvpnd lists the attempt's stored row ('active') FIRST and the
  // reconnecting session second; adopt must take the reconnecting one, never show the attempt as Connected.
  it('adopt during a redial takes the reconnecting session, not the attempt listed first', async () => {
    const row = (id: string, error = '') => ({ id, node: 'N', service: 'wireguard', status: 'active', error, channel: '', rxBytes: '0', txBytes: '0', spent: '0' });
    st.list = async () => [row('a1'), row('s1', 'connection lost; reconnecting')];
    await adoptRunningSession();
    expect((st.state.session as { id: string } | null)?.id).toBe('s1');
    expect(st.state.conn.phase).toBe('reconnecting');
  });

  // Q0366 pass 2 (2): the blocked screen after dvpnd gave up keeps dvpnd's reason (ended() passes it).
  it('after an unexpected end the blocked screen says why it ended, with Restore network', async () => {
    st.list = async () => [];
    const { closeReasonCopy } = await import('../../src/core/session/state');
    expect(await checkLeftoverBlock(closeReasonCopy('the connection to this server stopped working'))).toBe(true);
    expect(st.state.conn.restoreNetwork).toBe(true);
    expect(JSON.stringify(st.state.conn)).toContain('The connection to this server stopped working.');
    const src = (await import('node:fs')).readFileSync(new URL('../../src/main/services/connection.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/void checkLeftoverBlock\(copy\)/);
  });

  it('dvpnd answers with no session and the internet is down: Restore network is offered', async () => {
    st.list = async () => [];
    expect(await checkLeftoverBlock()).toBe(true);
    expect(st.state.conn.restoreNetwork).toBe(true);
  });

  it('dvpnd not running and the internet is down: Restore network is offered', async () => {
    st.reachable = false;
    expect(await checkLeftoverBlock()).toBe(true);
    expect(sessionStateUnknown()).toBe(false);
    expect(st.state.conn.restoreNetwork).toBe(true);
  });
});
