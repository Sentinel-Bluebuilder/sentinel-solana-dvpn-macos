// ─── Q0281 (port of the Windows app ddc80db): a SOCKS proxy of ours is never saved or restored as the user's setting ───
// the Windows app wx1: after "proxy off" + disconnect the system proxy still pointed at 127.0.0.1:1080 with no session,
// so every app using it had no internet. On macOS the same happens if a leftover of ours (a crash, a
// failed restore) is saved as "what the user had", or if the backup is gone while our proxy is on.
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setHost } from '../../src/main/host';
import { initStore, storePath } from '../../src/main/store';
import { clearSystemProxy, looksOurs, restorePlan, oursMarker, setProxyRunner, setSocksCheck, setSystemProxy, systemProxyActive, type ProxyState } from '../../src/main/system/proxy';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvpn-proxy-orphan-'));
beforeAll(() => {
  setHost({ name: 'cli', resourcesDir: dir, dataDir: dir, emit: () => undefined, keyStore: { kind: 'memory', exists: () => false, load: () => null, save: () => undefined, remove: () => undefined } });
  initStore(dir);
  setSocksCheck(async () => ({ ok: true, reason: 'stub' }));
});

const LEFT = { enabled: 'Yes' as const, server: '127.0.0.1', port: '1080' };
const clone = (s: ProxyState): ProxyState => ({ backend: s.backend, services: JSON.parse(JSON.stringify(s.services)) as ProxyState['services'] });
const fake = (start: ProxyState) => {
  let cur = clone(start);
  const sets: ProxyState[] = [];
  setProxyRunner({
    backend: async () => 'networksetup',
    query: async () => clone(cur),
    set: async (s) => {
      sets.push(clone(s));
      for (const [svc, p] of Object.entries(s.services)) cur.services[svc] = p.server ? { ...p } : { ...cur.services[svc], enabled: p.enabled };
      return clone(cur);
    },
  });
  return { now: () => cur, sets };
};

describe('system proxy: our own leftover (Q0281)', () => {
  it('a leftover of ours found at set time is saved as SOCKS off, so proxy off really turns it off', async () => {
    const f = fake({ backend: 'networksetup', services: { Ethernet: { ...LEFT, port: '10808' }, 'Wi-Fi': { enabled: 'No', server: '', port: '0' } } });
    await setSystemProxy('127.0.0.1:1080');
    // The backup itself never holds our proxy (the uninstaller reads this file too).
    const backup = JSON.parse(fs.readFileSync(storePath('proxy-backup.json'), 'utf8')) as { state: ProxyState };
    expect(backup.state.services.Ethernet).toEqual({ enabled: 'No', server: '', port: '0' });
    await clearSystemProxy();
    expect(f.now().services.Ethernet.enabled).toBe('No');
    expect(f.now().services['Wi-Fi'].enabled).toBe('No');
    expect(systemProxyActive()).toBe(false);
  });

  it('an explicit proxy off with no backup turns off a proxy of ours left on', async () => {
    const f = fake({ backend: 'networksetup', services: { Ethernet: LEFT, 'Wi-Fi': { enabled: 'Yes', server: 'corp-socks', port: '1081' } } });
    expect(systemProxyActive()).toBe(false);
    await clearSystemProxy({ orphan: true });
    expect(f.now().services.Ethernet.enabled).toBe('No');
    // Negative control: the user's own proxy on another service is never touched.
    expect(f.now().services['Wi-Fi']).toEqual({ enabled: 'Yes', server: 'corp-socks', port: '1081' });
    expect(f.sets).toEqual([{ backend: 'networksetup', services: { Ethernet: { enabled: 'No', server: '', port: '0' } } }]);
  });

  it('app start and session end (no orphan flag) leave it alone: no extra queries', async () => {
    const f = fake({ backend: 'networksetup', services: { Ethernet: LEFT } });
    await clearSystemProxy();
    expect(f.now().services.Ethernet).toEqual(LEFT);
    expect(f.sets).toEqual([]);
  });

  it('a saved leftover of ours is restored as SOCKS off; any loopback port counts as ours', () => {
    const now: ProxyState = { backend: 'networksetup', services: { A: LEFT, B: { ...LEFT, port: '2080' }, C: { enabled: 'Yes', server: '10.0.0.5', port: '1080' } } };
    const saved: ProxyState = { backend: 'networksetup', services: { A: { ...LEFT, port: '10808' }, B: { enabled: 'Yes', server: 'corp', port: '3128' }, C: { enabled: 'No', server: '', port: '0' } } };
    const plan = restorePlan(now, saved, oursMarker('127.0.0.1:1080'));
    expect(plan.services.A).toEqual({ enabled: 'No', server: '', port: '0' });
    expect(plan.services.B).toEqual({ enabled: 'Yes', server: 'corp', port: '3128' });
    expect(plan.services.C).toBeUndefined(); // not ours now: left alone
  });

  it('looksOurs: SOCKS on loopback only', () => {
    expect(looksOurs(LEFT)).toBe(true);
    expect(looksOurs({ ...LEFT, enabled: 'No' })).toBe(false);
    expect(looksOurs({ ...LEFT, server: '10.0.0.1' })).toBe(false);
    expect(looksOurs(undefined)).toBe(false);
  });
});
