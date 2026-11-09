// ─── Every dvpnd capability check reads pin / lab / release tags as a current build ───
// QA 10-30 on Mac 67958c00 + a pin dvpnd: split read "applied" (ddv(), 40a8bac9) but "Whole computer
// for V2Ray and Xray" still said "needs a newer VPN service": macLevel() had its own tag rule.
import { describe, expect, it } from 'vitest';
import { daemonFixesKillSwitch, daemonSupportsSplit, fullSplit, killSwitchBlocksProtocol, macLevel, splitNotApplied } from '../../src/core/session/state';

const CURRENT = ['cf4c-9b3fc24-pin', 'cf4c-276fca5-lab', 'cf4c-9b3fc24-rc-final', 'cf4c372-rc', 'cf4c372-rc'];
const OLD = ['', 'cf4c372', 'cf4c372-rc', 'cf4c372-rc'];

describe('capability checks against dvpnd tags', () => {
  for (const tag of CURRENT) {
    it(`${tag}: every feature is there`, () => {
      expect(macLevel(tag)).toBeGreaterThanOrEqual(1);
      expect(fullSplit('darwin', tag)).toBe(true);
      expect(daemonSupportsSplit(tag)).toBe(true);
      expect(daemonFixesKillSwitch(tag)).toBe(true);
      expect(splitNotApplied({ daemonVersion: tag, service: 'v2ray', killSwitch: 'off', wholeDevice: true, hasApps: true, platform: 'darwin' })).toBeNull();
      expect(killSwitchBlocksProtocol('darwin', 'on', 'wireguard', tag)).toBeNull();
    });
  }

  // Negative controls: builds that really lack the macOS whole-device / split-by-app series.
  for (const tag of OLD) {
    it(`${tag || '(no tag)'}: no macOS whole-device`, () => {
      expect(macLevel(tag)).toBe(0);
      expect(fullSplit('darwin', tag)).toBe(false);
    });
  }

  it('an explicit -mac<n> still wins', () => {
    expect(macLevel('cf4c372-rc')).toBe(30);
  });
});
