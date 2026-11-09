import { describe, it, expect } from 'vitest';
import { browserArgs, browserCandidates, findBrowser } from '../../src/main/system/browser';

const fwd = (p: string): string => p.split('\\').join('/');

describe('browser through the VPN (F16.2) — macOS', () => {
  it('sends everything to the SOCKS endpoint and keeps DNS off this computer', () => {
    const a = browserArgs('127.0.0.1:1080', '/Users/u/p', 'https://api.ipify.org');
    expect(a).toContain('--proxy-server=socks5://127.0.0.1:1080');
    expect(a).toContain('--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1');
    expect(a).toContain('--user-data-dir=/Users/u/p');
    expect(a).toContain('--disable-quic');
    expect(a[a.length - 1]).toBe('https://api.ipify.org');
  });
  it('refuses anything but a local SOCKS endpoint', () => {
    expect(() => browserArgs('10.0.0.1:1080', 'p', 'u')).toThrow(/not a local SOCKS endpoint/);
    expect(() => browserArgs('127.0.0.1:1080 --evil', 'p', 'u')).toThrow();
  });
  it('looks in /Applications, then ~/Applications, inside the app bundle', () => {
    expect(browserCandidates('chrome', '/Users/u').map(fwd)).toEqual([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Users/u/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ]);
    expect(fwd(browserCandidates('brave', '/Users/u')[0])).toBe('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser');
    expect(findBrowser('edge', () => false)).toBeNull();
  });
});
