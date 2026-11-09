// ─── Include split never reads as "not going through the VPN" (DIR, QA split-control t+132) ───
// Fedora, dvpnd cf4c-276fca5-pin, hysteria2 with an include split: one IP check out of ~40 answered with
// the user's own IP (the IP service is not a chosen app, so that is by design) and the title flipped to
// "Connected, but traffic is not going through the VPN". The app had decided split was not in effect
// ("needs a newer VPN service") from the pin tag. Call site: the real client config + the real tag
// through splitForSession, then coverageOf with a home-IP reading.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-split-'));
let version = 'cf4c-276fca5-pin';

vi.mock('../../src/main/daemon/manager', () => ({
  DEFAULT_DAEMON_HOME: home,
  SERVICE_NAME: 'dvpnd-client',
  daemonInfo: () => ({ reachable: true, version }),
  deviceRecord: () => ({ home }),
  relinkDaemon: () => undefined,
  scriptPath: (n: string) => n,
}));
vi.mock('../../src/main/system/elevate', () => ({ runElevated: vi.fn() }));
vi.mock('../../src/main/host', () => ({ getHost: () => ({ emit: () => undefined }) }));

const { splitForSession } = await import('../../src/main/daemon/settings');
const { coverageOf, coverageCopy } = await import('../../src/core/session/coverage');

function writeConfig(mode: string): void {
  // cb33: one config.toml holds [network] and [split]
  fs.writeFileSync(path.join(home, 'config.toml'), [
    '[network]', 'kill_switch = "off"', '',
    '[split]', `mode = "${mode}"`, 'apps = []', 'routes = ["203.0.113.1/32"]', '',
  ].join('\n'));
}

const HOME_IP = '203.0.113.1';
const NODE_IP = '203.0.113.1';
const titleFor = (split: 'include' | 'exclude' | null, directIp: string): string =>
  coverageCopy(coverageOf({ proxyEndpoint: '', proxyActive: false, directIp, homeIp: HOME_IP, nodeIp: NODE_IP, split }), { vpnIp: directIp, homeIp: HOME_IP, checksOff: false }).title;

describe('include split, pin dvpnd, an IP check that answers with the home IP', () => {
  beforeEach(() => { version = 'cf4c-276fca5-pin'; writeConfig('include'); });

  it('the session runs with the include split in effect', () => {
    for (const p of ['wireguard', 'amneziawg', 'openvpn', 'hysteria2']) expect(splitForSession(p), p).toBe('include');
  });

  it('the home-IP sample keeps the split title, never "not going through the VPN"', () => {
    const split = splitForSession('hysteria2');
    for (const ip of [NODE_IP, HOME_IP]) {
      const t = titleFor(split, ip);
      expect(t, ip).toBe('Protected for the apps you chose');
      expect(t).not.toMatch(/not going through the VPN/);
    }
  });

  it('control: no split, a home-IP exit is still reported as a leak', () => {
    writeConfig('off');
    expect(splitForSession('hysteria2')).toBeNull();
    expect(titleFor(null, HOME_IP)).toMatch(/not going through the VPN/);
  });

  it('control: a dvpnd that names an older ddv build has no split, so the leak warning stays', () => {
    version = 'cf4c372-rc';
    expect(splitForSession('hysteria2')).toBeNull();
  });
});
