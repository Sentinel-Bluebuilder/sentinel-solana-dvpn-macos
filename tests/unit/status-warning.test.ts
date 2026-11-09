// Q0357: dvpnd's Session.warning reaches the CLI too: `status` prints the app's banner words, and
// `status --json` carries session.warning (the same LiveSession the app reads).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sessionWarningCopy } from '../../src/core/session/state';

const read = (p: string): string => readFileSync(join(__dirname, '..', '..', p), 'utf8');

describe('status shows the live session warning', () => {
  it('prints a Warning line with the banner copy', () => {
    const src = read('src/cli/status-cmd.ts');
    expect(src).toMatch(/const warning = sessionWarningCopy\(s\.session\?\.warning\);/);
    expect(src).toMatch(/if \(warning\) lines\.push\(`Warning  \$\{warning\}`\);/);
    expect(sessionWarningCopy('large-packets')).toMatch(/drops large packets/);
  });

  it('the JSON session carries the warning code', () => {
    expect(read('src/main/services/connection.ts')).toMatch(/warning: s\.warning \?\? ''/);
    expect(read('src/cli/status-cmd.ts')).toMatch(/session: s\.session,/);
  });
});
