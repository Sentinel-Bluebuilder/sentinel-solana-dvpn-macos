// Fleet bug #3: an admin step that timed out after the change went through is read back, not reported as failed.
import { describe, expect, it } from 'vitest';
import { appliedAsStaged } from '../../src/main/daemon/settings';

describe('appliedAsStaged (cb33 single config.toml)', () => {
  const staged = '[network]\nkill_switch = "persist"\n';
  it('the installed config equals what was staged: applied', () => {
    expect(appliedAsStaged(staged, staged)).toBe(true);
  });
  it('the config differs, or nothing is readable: not applied', () => {
    expect(appliedAsStaged('[network]\nkill_switch = "off"\n', staged)).toBe(false);
    expect(appliedAsStaged(null, staged)).toBe(false);
  });
});
