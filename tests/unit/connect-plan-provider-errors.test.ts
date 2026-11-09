// ─── Q0068 (port of the Windows app 67b77ab): plan connect errors say what the provider refused ───
import { describe, expect, it } from 'vitest';
import { connectErrorCopy } from '../../src/core/session/state';

describe('plan provider refusals (Q0068)', () => {
  it('a wrong device clock and an unreachable provider get their own copy', () => {
    expect(connectErrorCopy('403 Forbidden: ticket_request_stale: ticket request is stale').code).toBe('ticket_request_stale');
    expect(connectErrorCopy('issuing ticket: ticket request is stale').message).toMatch(/clock/);
    expect(connectErrorCopy('ticket_request_stale').retry).toBe(false);
    expect(connectErrorCopy('502 Bad Gateway: provider_unreachable: provider did not answer').code).toBe('provider_unreachable');
    expect(connectErrorCopy('ticket_request_stale: ticket request is stale: check the device clock').code).toBe('ticket_request_stale');
  });

  it('a plain invalid ticket keeps its copy (negative control)', () => {
    expect(connectErrorCopy('403 Forbidden: invalid_ticket: ticket is not valid').code).toBe('ticket_invalid');
  });
});
