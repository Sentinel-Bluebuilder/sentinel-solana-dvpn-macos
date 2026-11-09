// ─── Split tunnelling capability (apps: V2Ray/Xray rc+; routes: all six from rc) ───
import { describe, expect, it } from 'vitest';
import { daemonSupportsSplit, splitNotApplied } from '../../src/core/session/state';

describe('split capability', () => {
  it('needs rc', () => {
    expect(daemonSupportsSplit('cf4c372-rc')).toBe(false);
    expect(daemonSupportsSplit('cf4c372-rc')).toBe(true);
    expect(daemonSupportsSplit(null)).toBe(false);
  });
  it('V2Ray/Xray: apps and routes in whole-device mode', () => {
    const ok = { daemonVersion: 'cf4c372-rc', service: 'xray', killSwitch: 'off', wholeDevice: true, hasApps: true };
    expect(splitNotApplied(ok)).toBeNull();
    expect(splitNotApplied({ ...ok, service: 'V2Ray' })).toBeNull();
    expect(splitNotApplied({ ...ok, wholeDevice: false })).toMatch(/Whole computer/);
    expect(splitNotApplied({ ...ok, daemonVersion: 'cf4c372-rc' })).toMatch(/newer/);
  });
  it('other protocols: routes from rc, never apps', () => {
    const ok = { daemonVersion: 'cf4c372-rc', service: 'wireguard', killSwitch: 'off', hasApps: false };
    for (const service of ['wireguard', 'amneziawg', 'openvpn', 'hysteria2']) expect(splitNotApplied({ ...ok, service })).toBeNull();
    expect(splitNotApplied({ ...ok, daemonVersion: 'cf4c372-rc' })).toMatch(/newer/);
    expect(splitNotApplied({ ...ok, hasApps: true })).toMatch(/newer VPN service on this Mac/);
    const win = { ...ok, hasApps: true, platform: 'win32' };
    expect(splitNotApplied({ ...win, daemonVersion: 'cf4c372-rc' })).toMatch(/newer/);
    for (const service of ['wireguard', 'amneziawg', 'openvpn']) expect(splitNotApplied({ ...win, daemonVersion: 'cf4c372-rc', service })).toBeNull();
    expect(splitNotApplied({ ...win, daemonVersion: 'cf4c372-rc', service: 'hysteria2' })).toMatch(/newer/);
    expect(splitNotApplied({ ...win, daemonVersion: 'cf4c372-rc', service: 'hysteria2' })).toBeNull();
    expect(splitNotApplied({ ...ok, service: null })).toMatch(/not available/);
  });
  it('kill switch on: Windows rc+ only', () => {
    const o = { daemonVersion: 'cf4c372-rc', service: 'xray', killSwitch: 'on', wholeDevice: true, platform: 'win32' };
    expect(splitNotApplied(o)).toMatch(/kill switch off/);
    expect(splitNotApplied({ ...o, daemonVersion: 'cf4c372-rc' })).toBeNull();
    expect(splitNotApplied({ ...o, daemonVersion: 'cf4c372-rc', service: 'wireguard' })).toBeNull();
    expect(splitNotApplied({ ...o, daemonVersion: 'cf4c372-rc', platform: 'linux' })).toMatch(/kill switch off/);
  });
  it('Linux: routes on the four tunnel protocols, never apps, V2Ray/Xray stay a proxy', () => {
    const lx = { daemonVersion: 'cf4c372-rc', killSwitch: 'off', platform: 'linux' };
    for (const service of ['wireguard', 'amneziawg', 'openvpn', 'hysteria2']) {
      expect(splitNotApplied({ ...lx, service })).toBeNull();
      expect(splitNotApplied({ ...lx, service, hasApps: true })).toMatch(/address range only/);
    }
    for (const service of ['v2ray', 'xray']) {
      // no "Whole computer" toggle exists here, so it must not be offered
      const why = splitNotApplied({ ...lx, service, wholeDevice: false });
      expect(why).toMatch(/proxy here/);
      expect(why).not.toMatch(/Whole computer/);
    }
  });
});
