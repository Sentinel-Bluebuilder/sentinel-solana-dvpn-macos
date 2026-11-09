// ─── App shell: first-run gate → sidebar + screen ───
// The welcome/onboarding screen always comes first (one-shot §1); the main UI
// opens only once the wallet, device, permission and service are all in place.
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp, bindEvents, call } from './lib/store';
import { t, type StringKey } from './lib/strings';
import { Toasts, Banner, AppMark, DevnetBadge } from './components/ui';
import { ProtocolTag } from './components/ProtocolMark';
import { Onboarding, onboardingStep } from './screens/Onboarding';
import { showSetupScreen, lostSetupCopy } from '../../core/session/setup-gate';
import { InstallServiceButton } from './components/InstallServiceButton';
import { Home } from './screens/Home';
import { Nodes } from './screens/Nodes';
import { Plans } from './screens/Plans';
import { Activity } from './screens/Activity';
import { Wallet } from './screens/Wallet';
import { Settings } from './screens/Settings';
import { Diagnostics } from './screens/Diagnostics';
import { Cli } from './screens/Cli';
import { NodeTest } from './screens/NodeTest';
import { KillSwitch } from './screens/KillSwitch';
import { SplitTunnel } from './screens/SplitTunnel';
import type { AppSnapshot, AppSettings, NodeView } from '../../shared/types';

export type Screen = 'home' | 'nodes' | 'plans' | 'activity' | 'nodetest' | 'wallet' | 'killswitch' | 'split' | 'settings' | 'diagnostics' | 'cli';
// Icon paths (24×24, stroke) — drawn inline so nothing is fetched.
const ICON: Record<Screen, string> = {
  home: 'M12 2v6M6.3 6.3a8 8 0 1 0 11.4 0',
  nodes: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  plans: 'M4 7h16v10H4zM4 11h16M8 15h3',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  nodetest: 'M9 3h6M10 3v6L4.5 18.5A1.6 1.6 0 0 0 5.9 21h12.2a1.6 1.6 0 0 0 1.4-2.5L14 9V3M7 15h10',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  killswitch: 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3zM9 12l2 2 4-4',
  split: 'M6 3v6a6 6 0 0 0 6 6h0a6 6 0 0 1 6 6M18 3v6a6 6 0 0 1-3 5.2M6 21v-3',
  diagnostics: 'M22 12h-4l-3 9L9 3l-3 9H2',
  cli: 'M4 17l6-5-6-5M12 19h8',
};
const NAV: Array<{ id: Screen; key: StringKey }> = [
  { id: 'home', key: 'nav.home' },
  { id: 'nodes', key: 'nav.nodes' },
  { id: 'plans', key: 'nav.plans' },
  { id: 'activity', key: 'nav.activity' },
  { id: 'nodetest', key: 'nav.nodetest' },
  { id: 'wallet', key: 'nav.wallet' },
  { id: 'killswitch', key: 'nav.killswitch' },
  { id: 'split', key: 'nav.split' },
  { id: 'settings', key: 'nav.settings' },
  { id: 'diagnostics', key: 'nav.diagnostics' },
  { id: 'cli', key: 'nav.cli' },
];

export function Icon({ d, className = 'h-[18px] w-[18px]' }: { d: string; className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('screen crashed', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card m-6">
        <h2 className="mb-2 font-semibold">This screen hit a problem.</h2>
        <p className="mb-4 text-sm text-fg-dim">Your connection is not affected. {this.state.error.message}</p>
        <button className="btn-ghost" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}

function applyTheme(theme: AppSettings['theme']): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

export function App() {
  const { snap, settings, setSnap, setSettings } = useApp();
  const [screen, setScreen] = useState<Screen>('home');
  const [welcomed, setWelcomed] = useState(false);
  const sawSetup = useRef(false);
  const setupDone = useRef(false); // set up at least once this run: a lost step shows a banner, not setup

  useEffect(() => {
    const off = bindEvents();
    void call<AppSnapshot>(window.api.IPC.STATE_SNAPSHOT).then(setSnap);
    void call<AppSettings>(window.api.IPC.SETTINGS_GET).then(setSettings);
    void call<NodeView[]>(window.api.IPC.NODES_LIST, undefined, { quiet: true }).then((list) => {
      if (list.length) useApp.getState().setNodes(list);
      else void call(window.api.IPC.NODES_REFRESH, undefined, { quiet: true });
    }, (err) => console.warn('node list failed', err));
    const offGo = window.api.on<Screen>(window.api.EVENTS.GO, (s) => { if (s in ICON) setScreen(s); });
    return () => { off(); offGo(); };
  }, [setSnap, setSettings]);

  useEffect(() => { if (settings) applyTheme(settings.theme); }, [settings]);

  if (!snap) return <div className="flex h-full flex-col items-center justify-center gap-4 text-fg-dim"><AppMark size={48} /><span className="font-display text-sm tracking-[0.04em]">Starting…</span></div>;

  // F2.1: welcome first on every launch. A wallet made or imported in this run counts as welcomed.
  if (!snap.hasWallet) sawSetup.current = true;
  const showWelcome = snap.hasWallet && !welcomed && !sawSetup.current;
  const step = onboardingStep(snap);
  if (!snap.hasWallet) setupDone.current = false; // logout: setup again from the start
  if (step === 'done' && !showWelcome) setupDone.current = true;
  const deviceUnknown = !snap.daemon.reachable && snap.wallet === null; // neither source read yet
  const lost = !showWelcome && step !== 'done' && !showSetupScreen(step, setupDone.current, !!snap.wallet?.device, deviceUnknown) ? lostSetupCopy(step, snap.wallet) : null;
  if (showWelcome || (step !== 'done' && !lost)) {
    return (
      <>
        <Onboarding snap={snap} onContinue={showWelcome ? () => setWelcomed(true) : undefined} />
        <Toasts />
      </>
    );
  }

  return (
    <div className="flex h-full">
      <nav className="flex w-60 shrink-0 flex-col border-r border-line bg-bg-card/70 p-3 backdrop-blur" aria-label="Main">
        {/* Brand row: the mark + the name, nothing else. px-3 = the menu items' padding, so the mark's
            left edge sits on the icon column; the name is on the type scale (section, 18 px); the
            hairline is set off from the first item by the same 12 px the items use between groups. */}
        <div className="mb-3 flex h-16 items-center gap-3 border-b border-line px-3 pb-1" data-brand-row>
          <AppMark size={28} />
          <div className="min-w-0 truncate font-display text-section font-semibold leading-none tracking-[-0.01em]">
            Devnet <span className="bg-sol bg-clip-text text-transparent">dVPN</span>
          </div>
        </div>
        {NAV.map((n) => {
          const on = screen === n.id;
          return (
            <button
              key={n.id}
              onClick={() => setScreen(n.id)}
              aria-current={on ? 'page' : undefined}
              className={`group relative mb-1 flex h-10 items-center gap-3 rounded-[10px] px-3 text-left text-ctl transition-colors ${on ? 'bg-sol-soft text-fg' : 'text-fg-dim hover:bg-bg-hover hover:text-fg'}`}
            >
              {on && <span className="absolute left-0 top-2 h-6 w-[3px] rounded-r bg-sol" aria-hidden />}
              <Icon d={ICON[n.id]} className={`h-[18px] w-[18px] ${on ? 'text-sol-green' : 'text-fg-muted group-hover:text-fg-dim'}`} />
              {t(n.key)}
            </button>
          );
        })}
        <div className="mt-auto space-y-3 px-1">
          <div className={`rounded-[12px] border p-3 ${snap.conn.phase === 'connected' ? 'border-ok/30 bg-ok-soft' : 'border-line bg-bg-raised/60'}`}>
            <div className="flex items-center gap-2 text-sm font-medium"><ConnDot phase={snap.conn.phase} /> {snap.conn.title}</div>
            {snap.session && <div className="mt-1 truncate text-meta text-fg-muted"><ProtocolTag protocol={snap.session.service} size={16} /> · {snap.session.node.slice(0, 6)}…</div>}
          </div>
          <div className="px-1 pb-1"><DevnetBadge /></div>
        </div>
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto px-6 py-6 lg:px-8">
        {/* One container for every screen: centred, same edges everywhere, 1200 px at most. */}
        <div className="page flex min-h-full flex-col">
        {snap.rpc.publicOnly && screen !== 'settings' && (
          <Banner kind="info" action={<button className="btn-ghost btn-sm" onClick={() => setScreen('settings')}>Settings</button>}>{t('rpc.publicOnly')}</Banner>
        )}
        {lost && (
          <Banner kind="warn" action={step === 'service' ? <InstallServiceButton /> : screen !== lost.screen ? <button className="btn-ghost btn-sm" onClick={() => setScreen(lost.screen)}>{lost.screen === 'wallet' ? 'Wallet' : 'Diagnostics'}</button> : undefined}>
            <span data-setup-lost={step}>{lost.text}</span>
          </Banner>
        )}
        {snap.daemon.networkOk === false && <Banner kind="error">The VPN service is set up for a different network than this app. Connecting is blocked until it is re-installed for Solana devnet.</Banner>}
        <ErrorBoundary key={screen}>
          {screen === 'home' && <Home snap={snap} go={setScreen} />}
          {screen === 'nodes' && <Nodes snap={snap} go={setScreen} />}
          {screen === 'plans' && <Plans snap={snap} />}
          {screen === 'activity' && <Activity snap={snap} go={setScreen} />}
          {screen === 'nodetest' && <NodeTest snap={snap} />}
          {screen === 'wallet' && <Wallet snap={snap} />}
          {screen === 'killswitch' && <KillSwitch snap={snap} />}
          {screen === 'split' && <SplitTunnel snap={snap} />}
          {screen === 'settings' && <Settings go={setScreen} />}
          {screen === 'diagnostics' && <Diagnostics snap={snap} />}
          {screen === 'cli' && <Cli />}
        </ErrorBoundary>
        </div>
      </main>
      <Toasts />
    </div>
  );
}

export function ConnDot({ phase }: { phase: string }) {
  const c = phase === 'connected' ? 'bg-ok shadow-[0_0_0_3px_rgb(var(--sol-green)/.18)]' : phase === 'error' ? 'bg-bad' : phase === 'idle' ? 'bg-fg-muted' : 'bg-warn animate-pulse';
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${c}`} aria-hidden />;
}
