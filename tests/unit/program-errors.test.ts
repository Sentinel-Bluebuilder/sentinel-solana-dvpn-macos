// ─── Devnet program error numbers ───
// Since the 2026-10-21 redeploy (upstream cf4c372) the chain numbers errors exactly as the
// bundled IDL does. These pins catch a future IDL swap that renumbers silently.
import { describe, expect, it } from 'vitest';
import { describeProgramError, devnetCodeOf } from '../../src/core/chain/errors';

describe('describeProgramError', () => {
  it('channel and grant errors by number', () => {
    expect(describeProgramError(6032).name).toBe('ChannelNotOpen');
    expect(describeProgramError(6033).name).toBe('ChannelNotClosing');
    expect(describeProgramError(6035).name).toBe('GraceNotElapsed');
    expect(describeProgramError(6024).name).toBe('AmountExceedsAllowance');
    expect(describeProgramError(6045).name).toBe('GrantExpired');
    expect(describeProgramError(6046).name).toBe('PermissionNotGranted');
    expect(describeProgramError(6048).name).toBe('InvalidVoucherSigner');
  });
  it('Anchor framework codes', () => {
    expect(describeProgramError(102).name).toBe('InstructionDidNotDeserialize');
  });
  it('devnetCodeOf round-trips names', () => {
    expect(devnetCodeOf('GraceNotElapsed')).toBe(6035);
    expect(devnetCodeOf('PermissionNotGranted')).toBe(6046);
    expect(devnetCodeOf('NoSuchError')).toBeNull();
  });
});
