// ─── Polling cadences (F5): settings rules, cadence checker, daemon flag units ───
import { describe, expect, it } from 'vitest';
import { POLL_JOBS, POLL_JOB_NAMES, DEFAULT_POLL, sanitizePoll, validPoll } from '../../src/shared/poll';
import { checkCadence, MAY_SKIP } from '../../src/core/app/poll-check';
import { escrowFlag, wholeFlag } from '../../src/core/daemon/flags';

describe('poll settings', () => {
  it('defaults sit inside each range', () => {
    for (const k of POLL_JOB_NAMES) {
      const j = POLL_JOBS[k];
      expect(j.def).toBeGreaterThanOrEqual(j.min);
      expect(j.def).toBeLessThanOrEqual(j.max);
    }
  });
  it('validPoll accepts whole seconds in range only', () => {
    expect(validPoll('wallet', 15)).toBe(15);
    expect(validPoll('wallet', '30')).toBe(30);
    expect(validPoll('wallet', 14)).toBeNull();
    expect(validPoll('wallet', 3601)).toBeNull();
    expect(validPoll('wallet', 20.5)).toBeNull();
    expect(validPoll('wallet', '1e3')).toBeNull();
    expect(validPoll('bogus', 30)).toBeNull();
  });
  it('sanitizePoll keeps valid entries, drops the rest, fills from base', () => {
    const base = { ...DEFAULT_POLL, dns: 7 };
    const out = sanitizePoll({ wallet: 20, nodes: 1, bogus: 5, ip: 'x' }, base);
    expect(out.wallet).toBe(20);
    expect(out.nodes).toBe(DEFAULT_POLL.nodes);
    expect(out.dns).toBe(7);
    expect('bogus' in out).toBe(false);
    expect(sanitizePoll('nope')).toEqual(DEFAULT_POLL);
    expect(sanitizePoll(null, base)).toEqual(base);
  });
});

describe('checkCadence', () => {
  const jobs = [
    { name: 'wallet', everyMs: 15_000, whenHidden: false },
    { name: 'settlements', everyMs: 15_000, whenHidden: true },
    { name: 'nodes', everyMs: 300_000, whenHidden: false },
  ];
  const runs = (name: string, ...s: number[]) => s.map((x) => ({ name, at: x * 1000 }));
  it('passes jobs that keep their interval', () => {
    const r = checkCadence(jobs, [...runs('wallet', 0, 15, 30), ...runs('settlements', 0, 15, 30), ...runs('nodes', 0)], 40_000, false);
    expect(r.every((x) => x.ok)).toBe(true);
  });
  it('a session job that skipped (no service, or a session already shown) is not a failure', () => {
    const withSession = [...jobs, { name: 'session', everyMs: 15_000, whenHidden: false }];
    const r = checkCadence(withSession, [...runs('wallet', 0), ...runs('settlements', 0), ...runs('nodes', 0)], 10_000, false, 1000, MAY_SKIP);
    expect(r.find((x) => x.name === 'session')!.ok).toBe(true);
    expect(MAY_SKIP).toContain('session');
  });
  it('fails a job that runs too often', () => {
    const r = checkCadence(jobs, [...runs('wallet', 0, 5, 10), ...runs('settlements', 0), ...runs('nodes', 0)], 40_000, false);
    expect(r.find((x) => x.name === 'wallet')!.ok).toBe(false);
  });
  it('allows one tick of slack', () => {
    const r = checkCadence(jobs, [...runs('wallet', 0, 14.2), ...runs('settlements', 0), ...runs('nodes', 0)], 20_000, false);
    expect(r.find((x) => x.name === 'wallet')!.ok).toBe(true);
  });
  it('fails a job that never ran, unless it may skip', () => {
    const r = checkCadence(jobs, runs('settlements', 0), 10_000, false, 1000, ['nodes']);
    expect(r.find((x) => x.name === 'wallet')!.ok).toBe(false);
    expect(r.find((x) => x.name === 'nodes')!.ok).toBe(true);
  });
  it('hidden: paused jobs must not run, hidden-allowed jobs must', () => {
    expect(checkCadence(jobs, [...runs('settlements', 0)], 10_000, true, 1000, ['nodes']).every((x) => x.ok)).toBe(true);
    expect(checkCadence(jobs, [...runs('settlements', 0), ...runs('wallet', 0)], 10_000, true).find((x) => x.name === 'wallet')!.ok).toBe(false);
  });
});

describe('daemon set flag units', () => {
  it('escrow tDVPN -> base units (6 decimals)', () => {
    expect(escrowFlag('2.5')).toBe('2500000');
    expect(escrowFlag('1')).toBe('1000000');
    for (const bad of ['0', '-1', 'abc', '1.1234567', '']) expect(() => escrowFlag(bad)).toThrow();
  });
  it('MB / minutes -> bytes / seconds', () => {
    expect(wholeFlag('prepay-mb', '100', 1_000_000n)).toBe('100000000');
    expect(wholeFlag('prepay-minutes', '10', 60n)).toBe('600');
    expect(wholeFlag('prepay-mb', '0', 1n)).toBe('0'); // 0 = node minimum (the Android app)
    for (const bad of ['1.5', '-3', 'x', '']) expect(() => wholeFlag('prepay-mb', bad, 1n)).toThrow();
  });
});
