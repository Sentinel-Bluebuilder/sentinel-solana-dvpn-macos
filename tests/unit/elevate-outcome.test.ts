// An admin step that wrote no result: a time-out must not be reported as a declined prompt.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { elevateTimeoutMs, elevator, noResultOutcome, setElevator } from '../../src/main/system/elevate';

describe('noResultOutcome', () => {
  it('a step cut off by the time limit says so, with the limit', () => {
    const r = noResultOutcome(true, 180_000, true);
    expect(r.status).toBe('error');
    expect(r.detail).toMatch(/did not finish within 180 s/);
    expect(r.detail).not.toMatch(/declined/);
  });
  it('a dismissed password prompt is a declined prompt', () => {
    expect(noResultOutcome(false, 60_000, true)).toEqual({ status: 'cancelled', detail: 'The administrator permission prompt was declined or closed.' });
  });
  it('any other missing result names the last error line', () => {
    expect(noResultOutcome(false, 60_000, false, 'one\nsudo: a password is required\n').detail).toBe('The administrator step did not finish: sudo: a password is required');
    expect(noResultOutcome(false, 60_000).detail).toBe('The administrator step did not finish.');
  });
});

describe('elevator override (rig proof of the password prompt)', () => {
  // These cases are about a normal user; a uid-0 run (CI in a root container) is always 'root'.
  beforeEach(() => { if (typeof process.getuid === 'function') vi.spyOn(process as unknown as { getuid: () => number }, 'getuid').mockReturnValue(1000); });
  afterEach(() => { vi.restoreAllMocks(); });
  it('DVPN_ELEVATOR=osascript picks the path that asks for the password', async () => {
    setElevator(null);
    process.env.DVPN_ELEVATOR = 'osascript';
    try {
      expect(await elevator()).toBe('osascript');
    } finally {
      delete process.env.DVPN_ELEVATOR;
      setElevator(null);
    }
  });
  it('any other value is ignored: it can never choose a path that skips the prompt', async () => {
    setElevator(null);
    process.env.DVPN_ELEVATOR = 'sudo';
    try {
      // On the laptop (no passwordless sudo) the real probe decides; it is never forced to sudo/root.
      expect(['osascript', 'sudo', 'root']).toContain(await elevator());
      setElevator(null);
      process.env.DVPN_ELEVATOR = 'root';
      expect(await elevator()).not.toBe('root');
    } finally {
      delete process.env.DVPN_ELEVATOR;
      setElevator(null);
    }
  });
});

describe('elevateTimeoutMs (fleet bug #3)', () => {
  it('120 s by default; DVPN_ELEVATE_TIMEOUT_MS within 10 s – 15 min wins; anything else is ignored', () => {
    expect(elevateTimeoutMs({})).toBe(120_000);
    expect(elevateTimeoutMs({ DVPN_ELEVATE_TIMEOUT_MS: '300000' })).toBe(300_000);
    expect(elevateTimeoutMs({ DVPN_ELEVATE_TIMEOUT_MS: '5' })).toBe(120_000);
    expect(elevateTimeoutMs({ DVPN_ELEVATE_TIMEOUT_MS: 'x' })).toBe(120_000);
  });
});
