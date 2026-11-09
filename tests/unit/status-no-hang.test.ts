// ─── `status` never waits out the network (Q0372) ───
// QA (Linux, wg, kill switch on) and TWD (Windows): during a tunnel cut every status call took
// 71-90 s, each RPC/IP read waiting for its own timeout one after another. With every network read
// hanging, status must answer within the budget and show the unread parts as unknown.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);
const st = vi.hoisted(() => ({
  adoptHangs: true,
  unknown: false,
  probe: ((..._a: unknown[]) => new Promise<boolean>(() => undefined)) as (...a: unknown[]) => Promise<boolean>,
  state: {
    owner: 'Owner1111111111111111111111111111111111111',
    session: { id: 's1', node: 'Node111111111111', service: 'wireguard', channel: 'Chan1', rxBytes: 0, txBytes: 0, spent: '0' } as Record<string, unknown> | null,
    conn: { title: 'Reconnecting — internet blocked to protect you', detail: '' },
    publicIp: null, homeIp: null, coverage: null,
  } as Record<string, unknown>,
}));

vi.mock('../../src/main/logger', () => ({ log: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('../../src/main/app-state', () => ({ snapshot: () => st.state, patch: (p: Record<string, unknown>) => Object.assign(st.state, p) }));
vi.mock('../../src/main/scheduler', () => ({ runJobNow: () => never() }));
vi.mock('../../src/main/services/wallet', () => ({ refreshWallet: () => never() }));
vi.mock('../../src/main/services/connection', () => ({
  adoptRunningSession: () => (st.adoptHangs ? never() : Promise.resolve()),
  sessionStateUnknown: () => st.unknown,
}));
vi.mock('../../src/main/daemon/manager', () => ({ daemonInfo: () => ({ reachable: true, version: 'test', device: 'Dev1' }) }));
vi.mock('../../src/main/system/proxy', () => ({ clearSystemProxy: vi.fn(), systemProxyActive: () => false }));
vi.mock('../../src/main/system/tunnels', () => ({ leftoverTunnels: () => never() }));
vi.mock('../../src/main/services/settlement', () => ({ readSettlements: () => never(), settlesOnEnd: (r: string) => !/switching servers/i.test(r) }));
vi.mock('../../src/core/quality/reachability', () => ({ internetReachable: (...a: unknown[]) => st.probe(...a) }));
vi.mock('../../src/core/chain/rpc', () => ({ getRpcUrls: () => ['https://rpc.invalid'] }));

const { statusCmd, STATUS_NET_BUDGET_MS, within } = await import('../../src/cli/status-cmd');

describe('status during a dead network (Q0372)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('answers within the budget with a live session, balances unknown', async () => {
    let printed = '';
    const done = statusCmd({ _: [], flags: {} } as never, { print: (t: string) => { printed = t; } } as never);
    // Adopt, then wallet + IP together, then the deposit read: three budgets at most.
    await vi.advanceTimersByTimeAsync(STATUS_NET_BUDGET_MS * 3 + 50);
    await done;
    expect(printed).toContain('balances unknown');
    expect(printed).toContain('Reconnecting');
    expect(STATUS_NET_BUDGET_MS * 3).toBeLessThan(10_000);
  });

  it('answers within the budget with no session (leftover + internet checks hang too)', async () => {
    st.state.session = null;
    st.adoptHangs = false; // dvpnd answered: no session, so the leftover and internet checks run (and hang)
    st.state.conn = { title: 'Not connected', detail: '' };
    let printed = '';
    let settled = false;
    const done = statusCmd({ _: [], flags: {} } as never, { print: (t: string) => { printed = t; } } as never).then(() => { settled = true; });
    // Q0366 pass 2 (QA fedora, KS blocking, no session): 5-8 s; DIR's gate is under 3 s. The wallet,
    // leftover and internet reads run together once dvpnd said "no session".
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(true);
    await done;
    expect(printed).toContain('Wallet');
    expect(printed).toContain('Not connected');
  });

  it('no session and the kill switch blocking: the blocked advice, each probe dial within the budget', async () => {
    st.state.session = null;
    st.adoptHangs = false;
    st.unknown = false;
    st.state.conn = { title: 'Not connected', detail: '' };
    const calls: unknown[][] = [];
    st.probe = (...a) => { calls.push(a); return new Promise((r) => setTimeout(() => r(false), (a[1] as { timeoutMs: number }).timeoutMs)); };
    let printed = '';
    let settled = false;
    const done = statusCmd({ _: [], flags: {} } as never, { print: (t: string) => { printed = t; } } as never).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(true);
    await done;
    expect(calls[0]?.[1]).toEqual({ timeoutMs: STATUS_NET_BUDGET_MS });
    expect(printed).toContain('Internet blocked');
  });

  // Q0373: dvpnd running but its session list did not answer (redialing): never "Not connected".
  it('a session read that does not answer reads unknown, not Not connected', async () => {
    st.state.session = null;
    st.state.conn = { title: 'Not connected', detail: '' };
    for (const [hangs, unknown] of [[true, false], [false, true]] as const) {
      st.adoptHangs = hangs;
      st.unknown = unknown;
      let printed = '';
      const done = statusCmd({ _: [], flags: {} } as never, { print: (t: string) => { printed = t; } } as never);
      await vi.advanceTimersByTimeAsync(STATUS_NET_BUDGET_MS * 2 + 50);
      await done;
      expect(printed).toContain('Session  unknown');
      expect(printed).not.toContain('Not connected');
      expect(printed).not.toContain('Internet blocked');
    }
  });

  it('within: a fast read passes through, a hung one is undefined at the budget', async () => {
    const fast = within(Promise.resolve(7), 100, 'fast');
    await vi.advanceTimersByTimeAsync(0);
    expect(await fast).toBe(7);
    let settled = false;
    const slow = within(never<number>(), 100, 'slow').then((v) => { settled = true; return v; });
    await vi.advanceTimersByTimeAsync(99);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await slow).toBeUndefined();
  });
});
