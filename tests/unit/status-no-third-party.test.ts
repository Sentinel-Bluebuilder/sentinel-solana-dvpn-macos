// ─── `status` contacts no third-party web service (Settings: "Off = never contacted") ───
// It used to fetch an Ubuntu connectivity page and api.ipify.org with no session, whatever
// thirdPartyChecks said. The internet probe is now the core TCP-only check.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = fs.readFileSync(path.join(__dirname, '../../src/cli/status-cmd.ts'), 'utf8');

describe('status internet probe', () => {
  it('uses the core TCP-only reachability check', () => {
    expect(src).toMatch(/from '\.\.\/core\/quality\/reachability'/);
    // Q0366 pass 2: the status read passes its own dial budget as options.
    expect(src).toMatch(/internetReachable\(getRpcUrls\(\)[,)]/);
  });

  it('fetches no outside site itself', () => {
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/connectivity-check|ipify|https?:\/\//);
  });
});
