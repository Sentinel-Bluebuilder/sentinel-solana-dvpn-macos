// The setup screen takes the window only on first use and after logout (VM test-host 2026-10-22).
import { describe, expect, it } from 'vitest';
import { deviceSolCopy, lostSetupCopy, notReadyReason, showSetupScreen } from '../../src/core/session/setup-gate';

describe('setup screen gate', () => {
  it('first use: every missing step shows setup', () => {
    for (const s of ['wallet', 'device', 'permission', 'service'] as const) expect(showSetupScreen(s, false, false)).toBe(true);
  });
  it('set up this run: a lost step keeps the main layout (session and Disconnect stay visible)', () => {
    for (const s of ['device', 'permission', 'service'] as const) expect(showSetupScreen(s, true, true)).toBe(false);
  });
  it('logout always goes back to setup', () => expect(showSetupScreen('wallet', true, true)).toBe(true));
  it('a device already on chain with a slow service at launch: banner, not "Install service"', () => {
    expect(showSetupScreen('service', false, true)).toBe(false);
    expect(showSetupScreen('permission', false, true)).toBe(true);
  });
  it('done never shows setup', () => expect(showSetupScreen('done', false, false)).toBe(false));
  it('after a restart with the service down and the wallet unread, the device is unknown: banner, not "Create this device\'s key"', () => {
    expect(showSetupScreen('device', false, false, true)).toBe(false);
    expect(lostSetupCopy('device')?.text).toMatch(/could not be read/);
    // negative controls: a device known to be missing still gets setup; unknown never hides the wallet step
    expect(showSetupScreen('device', false, false, false)).toBe(true);
    expect(showSetupScreen('wallet', false, false, true)).toBe(true);
    expect(showSetupScreen('service', false, false, true)).toBe(true);
  });
  it('App passes deviceUnknown only when neither the service nor the wallet has been read', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const app = readFileSync(join(__dirname, '../../src/renderer/src/App.tsx'), 'utf8');
    expect(app).toMatch(/const deviceUnknown = !snap\.daemon\.reachable && snap\.wallet === null;/);
    expect(app).toMatch(/showSetupScreen\(step, setupDone\.current, !!snap\.wallet\?\.device, deviceUnknown\)/);
  });
  it('each lost step has a banner that names where to fix it', () => {
    expect(lostSetupCopy('service')?.screen).toBe('diagnostics');
    expect(lostSetupCopy('permission')?.screen).toBe('wallet');
    expect(lostSetupCopy('device')?.screen).toBe('diagnostics');
    expect(lostSetupCopy('done')).toBeNull();
  });
});

describe('device short of fee SOL (test-host 2026-10-22)', () => {
  const ok = { grant: { allowance: '1' }, delegated: '5', deviceLamports: 9_000_000 };
  it('names the real cause, not "permission"', () => {
    expect(notReadyReason({ ...ok, deviceLamports: 4_300_000 })).toBe('device-sol');
    expect(notReadyReason({ ...ok, grant: null })).toBe('permission');
    expect(notReadyReason({ ...ok, delegated: '0' })).toBe('permission');
  });
  it('says what it has and what it needs, and where to fix it', () => {
    expect(deviceSolCopy(4_300_000)).toBe('This device needs a little SOL for transaction fees (has 0.0043, needs 0.005).');
    const c = lostSetupCopy('permission', { ...ok, deviceLamports: 4_300_000 });
    expect(c?.text).toMatch(/has 0\.0043, needs 0\.005\)\. Top it up in Wallet\./);
    expect(c?.screen).toBe('wallet');
    expect(lostSetupCopy('permission', { ...ok, grant: null })?.text).toMatch(/spending permission/);
  });
});
