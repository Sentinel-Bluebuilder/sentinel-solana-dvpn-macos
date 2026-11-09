// ─── Split support is never denied by an unfamiliar dvpnd tag (Q0366 pass 3, QA fedora) ───
// `split status` said "Split tunnelling needs a newer VPN service" for all six protocols against pin
// dvpnd cf4c-2038a5f-pin, which applied the split: the check read a ddv build number from the tag and
// a pin/release tag has none. Only a tag that names an older ddv build may say "newer".
import { describe, it, expect } from 'vitest';
import { ddv, daemonSupportsSplit, daemonFixesKillSwitch, splitNotApplied } from '../../src/core/session/state';

const NEWER = /needs a newer VPN service/;
const ROUTE = ['wireguard', 'amneziawg', 'openvpn', 'hysteria2'];

describe('dvpnd build from its tag', () => {
  it('pin, lab and release-style tags count as current', () => {
    for (const tag of ['cf4c-2038a5f-pin', 'cf4c-5dd2a60-pin', 'cf4c-19dc608-q0365b-lab', 'v0.1.11', '19.0.0']) {
      expect(daemonSupportsSplit(tag), tag).toBe(true);
      expect(daemonFixesKillSwitch(tag), tag).toBe(true);
      for (const p of ROUTE) expect(splitNotApplied({ daemonVersion: tag, service: p, killSwitch: 'off', platform: 'linux' }), `${tag} ${p}`).toBeNull();
      for (const p of ['v2ray', 'xray']) expect(splitNotApplied({ daemonVersion: tag, service: p, killSwitch: 'off', platform: 'linux' }) ?? '', `${tag} ${p}`).not.toMatch(NEWER);
    }
  });

  it('a tag naming an older ddv build still says a newer service is needed', () => {
    expect(ddv('cf4c372-rc')).toBe(18);
    expect(splitNotApplied({ daemonVersion: 'cf4c372-rc', service: 'wireguard', killSwitch: 'off', platform: 'linux' })).toMatch(NEWER);
    expect(splitNotApplied({ daemonVersion: 'cf4c372-rc', service: 'wireguard', killSwitch: 'off', platform: 'linux' })).toMatch(NEWER);
    expect(splitNotApplied({ daemonVersion: 'cf4c372-rc', service: 'wireguard', killSwitch: 'off', platform: 'linux' })).toBeNull();
    expect(daemonSupportsSplit('cf4c372-rc')).toBe(false);
  });

  it('no tag, or the pre-ddv base, is the oldest build', () => {
    for (const tag of [null, undefined, '', 'cf4c372']) {
      expect(ddv(tag), String(tag)).toBe(0);
      expect(daemonSupportsSplit(tag)).toBe(false);
    }
  });
});
