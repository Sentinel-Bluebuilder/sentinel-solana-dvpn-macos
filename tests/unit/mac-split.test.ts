// ─── macOS split tunnelling: capability by dvpnd build, app paths, app list parsing ───
import { describe, expect, it, vi } from 'vitest';
import { fullSplit, macLevel, splitNotApplied } from '../../src/core/session/state';
import { bundleExecutable, bundleName, displayName, isChoosableExe, isMacBundleExe, mergeApps, SAFARI_SPLIT_COPY, unsplittableReason } from '../../src/core/split/apps';
import { validateSplit } from '../../src/core/daemon/config';

vi.mock('../../src/main/logger', () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/daemon/manager', () => ({ scriptPath: (n: string) => n }));

const FF = '/Applications/Firefox.app/Contents/MacOS/firefox';

describe('macOS split capability', () => {
  it('reads the -mac<n> level from the dvpnd tag', () => {
    expect(macLevel('cf4c372-rc')).toBe(1);
    expect(macLevel('cf4c372-rc')).toBe(12);
    expect(macLevel('cf4c372-rc')).toBe(0);
    expect(macLevel(null)).toBe(0);
    // Fleet tags: the 18.34 build with the the macOS app patches is a bare -mac; 18.35+ has them in main.
    expect(macLevel('cf4c372-rc')).toBe(1);
    expect(macLevel('cf4c372-rc')).toBe(0);
    expect(macLevel('cf4c372-rc')).toBe(1);
    expect(macLevel('cf4c372-rc')).toBe(1);
    expect(fullSplit('darwin', 'cf4c372-rc')).toBe(true);
    expect(fullSplit('darwin', 'cf4c372-rc')).toBe(false);
    expect(fullSplit('darwin', 'cf4c372-rc')).toBe(true);
    expect(fullSplit('darwin', 'cf4c372-rc')).toBe(false);
    expect(fullSplit('linux', 'cf4c372-rc')).toBe(false);
    expect(fullSplit('win32', 'cf4c372-rc')).toBe(true);
  });
  it('before -mac1: routes only, V2Ray/Xray a proxy, kill switch drops the split', () => {
    const o = { daemonVersion: 'cf4c372-rc', killSwitch: 'off', platform: 'darwin' };
    for (const service of ['wireguard', 'amneziawg', 'openvpn', 'hysteria2']) {
      expect(splitNotApplied({ ...o, service })).toBeNull();
      expect(splitNotApplied({ ...o, service, hasApps: true })).toMatch(/newer VPN service on this Mac/);
    }
    for (const service of ['v2ray', 'xray']) expect(splitNotApplied({ ...o, service, wholeDevice: true })).toMatch(/proxy here/);
    expect(splitNotApplied({ ...o, service: 'wireguard', killSwitch: 'on' })).toMatch(/kill switch off/);
  });
  it('-mac1: apps on every protocol, V2Ray/Xray need Whole computer, kill switch keeps the split', () => {
    const o = { daemonVersion: 'cf4c372-rc', killSwitch: 'on', platform: 'darwin', hasApps: true };
    for (const service of ['wireguard', 'amneziawg', 'openvpn', 'hysteria2']) expect(splitNotApplied({ ...o, service })).toBeNull();
    expect(splitNotApplied({ ...o, service: 'xray', wholeDevice: true })).toBeNull();
    expect(splitNotApplied({ ...o, service: 'v2ray', wholeDevice: false })).toMatch(/Whole computer/);
  });
});

describe('macOS app paths', () => {
  it('accepts a bundle main executable only', () => {
    expect(isMacBundleExe(FF)).toBe(true);
    expect(isChoosableExe(FF)).toBe(true);
    expect(isChoosableExe('/Applications/My App.app/Contents/MacOS/My App')).toBe(true);
    expect(isChoosableExe('/usr/bin/curl')).toBe(false);
    expect(isChoosableExe('/Applications/Firefox.app')).toBe(false);
    expect(isChoosableExe('/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper')).toBe(false);
    expect(isChoosableExe('/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder')).toBe(false);
    expect(isChoosableExe('/Applications/Bad".app/Contents/MacOS/x')).toBe(false);
    expect(isChoosableExe('C:\\a\\b.exe')).toBe(true);
  });
  it('resolves a bundle to its executable and names it after the bundle', () => {
    expect(bundleExecutable('/Applications/Firefox.app', 'firefox')).toBe(FF);
    expect(bundleExecutable('/Applications/Firefox.app/', 'firefox\n')).toBe(FF);
    expect(bundleExecutable('/Applications/Firefox.app', '../evil')).toBeNull();
    expect(bundleExecutable('/Applications/Firefox', 'firefox')).toBeNull();
    expect(bundleName(FF)).toBe('Firefox');
    expect(displayName(FF)).toBe('Firefox');
    expect(displayName('C:\\x\\Steam.exe')).toBe('Steam');
  });
  it('dvpnd accepts the paths the picker gives', () => {
    expect(() => validateSplit({ mode: 'include', apps: [FF], routes: [] })).not.toThrow();
  });
  it('refuses a path dvpnd would refuse, before any admin prompt (dvpnd then failed to start and rolled back)', () => {
    expect(() => validateSplit({ mode: 'include', apps: ['/usr/bin/curl'], routes: [] })).toThrow(/an app's own program/);
    expect(() => validateSplit({ mode: 'include', apps: ['/Applications/Firefox.app'], routes: [] })).toThrow(/an app's own program/);
    expect(() => validateSplit({ mode: 'include', apps: ['C:\\Apps\\Steam.exe'], routes: [] })).not.toThrow();
  });
  it('merges installed and running apps, running first', () => {
    const apps = mergeApps(
      [{ name: 'Firefox', target: FF }, { name: 'Safari', target: '/Applications/Safari.app/Contents/MacOS/Safari' }],
      [{ name: '', path: '/Applications/Safari.app/Contents/MacOS/Safari' }, { name: '', path: '/Applications/Slack.app/Contents/MacOS/Slack' }],
    );
    expect(apps.map((a) => [a.name, a.running])).toEqual([['Safari', true], ['Slack', true], ['Firefox', false]]);
  });
});

describe('macOS running processes', () => {
  it('keeps bundle executables once, drops helpers and daemons', async () => {
    const { parseMacProcesses } = await import('../../src/main/system/apps');
    const ps = [
      '/sbin/launchd',
      FF,
      FF,
      '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/1/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
      '/System/Library/CoreServices/Dock.app/Contents/MacOS/Dock',
      '  /Applications/Slack.app/Contents/MacOS/Slack  ',
      '',
    ].join('\n');
    expect(parseMacProcesses(ps)).toEqual([{ name: 'Firefox', path: FF }, { name: 'Slack', path: '/Applications/Slack.app/Contents/MacOS/Slack' }]);
  });
});

describe('Safari cannot be split by app on macOS', () => {
  const SAFARI = '/Applications/Safari.app/Contents/MacOS/Safari';
  it('names Safari (and its preview) as not splittable, nothing else', () => {
    expect(unsplittableReason(SAFARI)).toBe(SAFARI_SPLIT_COPY);
    expect(unsplittableReason('/Applications/Safari Technology Preview.app/Contents/MacOS/Safari Technology Preview')).toBe(SAFARI_SPLIT_COPY);
    expect(unsplittableReason(FF)).toBeNull();
    expect(unsplittableReason('C:\Program Files\Safari\Safari.exe')).toBeNull();
  });
  it('the service config refuses Safari with the same words', () => {
    expect(() => validateSplit({ mode: 'include', apps: [SAFARI], routes: [] })).toThrow(SAFARI_SPLIT_COPY);
    expect(() => validateSplit({ mode: 'include', apps: [FF], routes: [] })).not.toThrow();
  });
});
