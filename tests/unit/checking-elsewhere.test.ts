import { describe, expect, it } from 'vitest';
import { ELSEWHERE_SESSION_MS, sessionEveryMs } from '../../src/main/scheduler';

// Q0357 (DIR): "Checking the connection…" comes from dvpnd's session status, so it must show for a
// connect started anywhere (the CLI too). dvpnd's check lasts a few seconds; the default 5 s session
// poll missed it, so the app polls every second while another process connects.
describe('session poll while a connect runs elsewhere', () => {
  it('runs every second while another process connects', () => {
    expect(sessionEveryMs(5000, true)).toBe(ELSEWHERE_SESSION_MS);
    expect(ELSEWHERE_SESSION_MS).toBeLessThanOrEqual(1000);
  });

  it('keeps the user cadence otherwise, and never slows a faster one', () => {
    expect(sessionEveryMs(5000, false)).toBe(5000);
    expect(sessionEveryMs(500, true)).toBe(500);
  });
});
