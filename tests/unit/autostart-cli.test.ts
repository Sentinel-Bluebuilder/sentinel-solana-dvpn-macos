// ─── `settings set|reset startWithOs` from the CLI writes the same LaunchAgent as the app ───
// builder-kb 10-23: the autostart header said "app and CLI" but only main/index.ts applied it, so
// `settings set startWithOs=true` changed nothing until the app next opened.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyStartWithOsFromCli, autostartPath, bundleExecutable } from '../../src/main/system/autostart';

const APP = '/Applications/Devnet dVPN.app/Contents/MacOS/Devnet dVPN';
let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ddv-autostart-'));
  vi.spyOn(os, 'homedir').mockReturnValue(home);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('bundleExecutable', () => {
  it('is the app binary only inside a .app bundle', () => {
    expect(bundleExecutable(APP)).toBe(APP);
    expect(bundleExecutable('/usr/local/bin/node')).toBeNull();
    expect(bundleExecutable('/Applications/Devnet dVPN.app/Contents/Resources/bin/devnet-dvpn')).toBeNull();
  });
});

describe('applyStartWithOsFromCli', () => {
  it('on: writes the LaunchAgent that starts the app hidden', () => {
    expect(applyStartWithOsFromCli(true, APP)).toBeNull();
    const text = fs.readFileSync(autostartPath(home), 'utf8');
    expect(text).toContain(`<string>${APP}</string><string>--hidden</string>`);
  });

  it('off: removes it', () => {
    applyStartWithOsFromCli(true, APP);
    expect(applyStartWithOsFromCli(false, APP)).toBeNull();
    expect(fs.existsSync(autostartPath(home))).toBe(false);
  });

  it('not from the bundle: changes no file and says when it takes effect', () => {
    const note = applyStartWithOsFromCli(true, '/usr/local/bin/node');
    expect(note).toMatch(/next time the app opens/);
    expect(fs.existsSync(autostartPath(home))).toBe(false);
  });
});
