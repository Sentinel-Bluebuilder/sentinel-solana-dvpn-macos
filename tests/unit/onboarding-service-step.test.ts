// Q0268 (FWA, DIR 10-30): onboarding's "Install service" is the shared InstallServiceButton, the same
// control as the "not answering" banner and Diagnostics (Q0305), so one uifire cell fires all of them.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(p, 'utf8');

describe('onboarding service step', () => {
  const src = read('src/renderer/src/screens/Onboarding.tsx');
  const step = src.slice(src.indexOf('function ServiceStep'), src.indexOf('\n}\n', src.indexOf('function ServiceStep')));

  it('renders the shared InstallServiceButton', () => {
    expect(src).toMatch(/import \{ InstallServiceButton \} from '\.\.\/components\/InstallServiceButton';/);
    expect(step).toMatch(/<InstallServiceButton className="btn-primary" \/>/);
  });

  it('has no install button of its own', () => {
    expect(step).not.toMatch(/<button/);
    expect(step).not.toMatch(/DAEMON_INIT/);
  });

  it('the shared button carries the test hook and the install call', () => {
    const btn = read('src/renderer/src/components/InstallServiceButton.tsx');
    expect(btn).toMatch(/data-install-service=\{state\}/);
    expect(btn).toMatch(/call\(window\.api\.IPC\.DAEMON_INIT, \{ step: 'install' \}\)/);
  });

  it('after a successful install the button reads Installed and stays disabled (no second administrator prompt)', () => {
    const btn = read('src/renderer/src/components/InstallServiceButton.tsx');
    expect(btn).toMatch(/disabled=\{state !== 'idle'\}/);
    expect(btn).toMatch(/state === 'done' \? 'Installed'/);
  });
});
