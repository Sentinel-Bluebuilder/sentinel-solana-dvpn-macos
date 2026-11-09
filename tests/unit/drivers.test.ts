import { describe, expect, it } from 'vitest';
import { driverLines, parseReport, DRIVER_LABELS } from '../../src/main/system/drivers';

// Shape written by resources/scripts/install-deps.sh --CheckOnly 1 (one JSON line).
const REAL = '{"at":"2026-10-22T15:30:00Z","ok":true,"rebootRequired":false,"deps":[{"name":"macos","wanted":"any","found":"14.7 (x86_64)","status":"present","detail":""},{"name":"wireguard","wanted":"any","found":"1.0.20250521","status":"present","detail":""}]}';

describe('driver report — macOS', () => {
  it('parses the script output', () => {
    const r = parseReport(REAL)!;
    expect(r.ok).toBe(true);
    expect(r.deps.map((d) => d.name)).toEqual(['macos', 'wireguard']);
  });

  it('accepts a one-driver report written as a bare object', () => {
    const r = parseReport('{"ok":false,"rebootRequired":false,"at":"x","deps":{"name":"macos","wanted":"any","found":"11.7","status":"incompatible","detail":"macOS 12 or newer is needed"}}')!;
    expect(r.ok).toBe(false);
    expect(r.deps).toHaveLength(1);
    expect(driverLines(r)[0]).toMatch(/^FAIL\s+macOS 12 or newer\s+incompatible 11\.7/);
  });

  it('marks missing drivers distinctly from failures', () => {
    const r = parseReport('{"ok":false,"deps":[{"name":"amneziawg","wanted":"any","found":"","status":"missing","detail":""}]}')!;
    expect(driverLines(r)[0]).toMatch(/^miss\s+AmneziaWG \(userspace\)\s+missing$/);
  });

  it('has a label for every row the script writes', () => {
    const names = /NAMES=\(([^)]+)\)/.exec(require('node:fs').readFileSync('resources/scripts/install-deps.sh', 'utf8'))![1].split(' ');
    expect(names.sort()).toEqual(Object.keys(DRIVER_LABELS).sort());
  });
});
