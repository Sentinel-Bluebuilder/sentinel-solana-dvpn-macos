// ─── Install service: the onboarding install, reachable after setup too (Q0305) ───
// On a set-up device whose service is gone, setup no longer takes the window (setup-gate), so the
// "not answering" banner and Diagnostics need this button or there is no way back short of a
// reinstall. Same call as onboarding (DAEMON_INIT install: one administrator prompt).
// Hooks: data-install-service="idle|busy|done"; errors reach the user through call()'s toast.
import { useState } from 'react';
import { call, useApp } from '../lib/store';

export function InstallServiceButton({ className = 'btn-primary btn-sm' }: { className?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  return (
    // 'done' stays disabled: a second click would raise a second administrator prompt (QA review of 27aae7e).
    <button className={className} disabled={state !== 'idle'} data-install-service={state} onClick={async () => {
      setState('busy');
      try {
        await call(window.api.IPC.DAEMON_INIT, { step: 'install' });
        useApp.getState().toast('success', 'VPN service installed.');
        setState('done');
      } catch (err) {
        console.warn('service install failed', err);
        setState('idle');
      }
    }}>{state === 'busy' ? 'Waiting for permission…' : state === 'done' ? 'Installed' : 'Install service'}</button>
  );
}
