// Q0361 / Q0366: the scheduler's session job is what runs the reconcile while a session is shown;
// without it an app that missed the stream's end stays on Connected / Reconnecting.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '..', '..', 'src', 'main', 'scheduler.ts'), 'utf8');

describe('session job reconciles a shown session', () => {
  it('a shown session is checked against dvpnd on every session poll', () => {
    expect(src).toMatch(/if \(s\.session\) return daemonInfo\(\)\.reachable && await reconcileShownSession\(\) \? undefined : SKIPPED;/);
  });
});
