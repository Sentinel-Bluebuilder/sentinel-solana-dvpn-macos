// ─── An end sent while dvpnd is still redialing is not the end (Q0366 pass 3) ───
// QA (fedora, v2ray, kill switch off, 2026-10-30 06:34): dvpnd's redial tears the dead tunnel down
// first and that teardown tells watchers the session ENDED ("the connection to this server stopped
// working"), then redials the same session; the real end comes when it gives up. A CLI `status`
// attached at that moment printed "Not connected" mid-redial.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  session: null as null | { id: string },
  phase: 'idle',
  list: [] as Array<Record<string, unknown>>,
  watchers: [] as Array<(s: Record<string, unknown>) => void>,
}));
vi.mock('../../src/main/system/proxy', () => ({ setSystemProxy: vi.fn(), clearSystemProxy: async () => undefined }));
vi.mock('../../src/main/app-state', () => ({
  snapshot: () => ({ session: st.session, conn: { phase: st.phase } }),
  patch: (p: { session?: unknown; conn?: { phase: string } }) => {
    if ('session' in p) st.session = p.session as { id: string } | null;
    if (p.conn) st.phase = p.conn.phase;
  },
  setSplitInEffect: vi.fn(),
  setWholeDeviceInEffect: vi.fn(), // macOS: the adopt/end paths set it
  toast: vi.fn(),
}));
vi.mock('../../src/main/daemon/manager', () => ({
  daemon: () => ({
    listSessions: async () => st.list,
    watchSession: (_id: string, onUpdate: (s: Record<string, unknown>) => void) => { st.watchers.push(onUpdate); return () => undefined; },
  }),
  daemonInfo: () => ({ reachable: true }),
}));
vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../src/main/services/history', () => ({ recordStart: vi.fn(), recordEnd: vi.fn() }));
vi.mock('../../src/main/services/settlement', () => ({ settleChannelSoon: vi.fn() }));
vi.mock('../../src/main/system/dns-check', () => ({ dnsReallyLeftOver: async () => false, flushDnsCache: vi.fn() }));
vi.mock('../../src/main/system/tunnels', () => ({ leftoverTunnels: async () => [], rivalVpns: async () => [], removeTunnelServices: async () => undefined }));
vi.mock('../../src/core/quality/reachability', () => ({ internetReachable: async () => true }));
vi.mock('../../src/core/chain/rpc', () => ({ getRpcUrls: () => [], resetRpcTransport: vi.fn(), onRpcRetry: () => () => undefined }));
vi.mock('../../src/main/daemon/settings', () => ({ getDaemonSettings: () => ({ settings: { dnsServers: [], killSwitch: 'off' } }), splitForSession: vi.fn(), serviceUsesTun: () => true }));

const { adoptRunningSession } = await import('../../src/main/services/connection');

const row = (status: string, error = '') => ({ id: 's1', node: 'N', service: 'v2ray', channel: '', status, error });
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('a stream end during a redial (Q0366 pass 3)', () => {
  beforeEach(() => {
    st.session = null;
    st.phase = 'idle';
    st.watchers = [];
  });

  it('the teardown end while dvpnd still lists the session reconnecting: kept and watched again', async () => {
    st.list = [row('active', 'connection lost; reconnecting')];
    await adoptRunningSession();
    expect(st.session?.id).toBe('s1');
    expect(st.phase).toBe('reconnecting');

    st.watchers.at(-1)!(row('ended', 'the connection to this server stopped working'));
    await settle();
    expect(st.session?.id).toBe('s1');
    expect(st.phase).toBe('reconnecting');
    expect(st.watchers.length).toBe(2); // watched again

    // dvpnd gives up: its list now says ended too, so this end is the end.
    st.list = [row('ended', 'the connection to this server stopped working')];
    st.watchers.at(-1)!(row('ended', 'the connection to this server stopped working'));
    await settle();
    expect(st.session).toBeNull();
  });

  it('negative control: an end dvpnd confirms (not listed running) clears the session at once', async () => {
    st.list = [row('active')];
    await adoptRunningSession();
    st.list = [row('ended', 'the connection to this server stopped working')];
    st.watchers.at(-1)!(row('ended', 'the connection to this server stopped working'));
    await settle();
    expect(st.session).toBeNull();
  });
});
