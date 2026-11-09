# Architecture — Devnet dVPN (macOS)

macOS build of the Windows app Devnet dVPN. The shared layers (`core/`, services, renderer, CLI catalogue)
are the same code as Windows and Linux; every platform piece and its macOS replacement is listed
in [`MAC-PORT.md`](MAC-PORT.md). Feature IDs (F*.*) refer to [`FEATURE-PLAN.md`](FEATURE-PLAN.md).

## Processes and trust

```
┌ Devnet dVPN — Electron, runs as the logged-in user ─────────────────────────┐
│                                                                              │
│  renderer (React, sandboxed)                                                 │
│     │  window.api.*  — typed, IPC enum only, no secrets ever                 │
│  preload (contextBridge)                                                     │
│     │                                                                        │
│  main process                                                                │
│     ├─ scheduler        one owner for every poll / stream (F5)               │
│     ├─ daemon client    grpc-js → unix:/var/db/dvpnd/client/daemon.sock      │
│     ├─ chain            RPC pool, decoders, tx builders, signer (F4, D2)     │
│     ├─ wallet           owner key in safeStorage = login Keychain (F2, D10)  │
│     ├─ nodes / plans    discovery, signed-metadata probe, TLS pin (F6, F10)  │
│     ├─ settlement       voucher close queue, withdraw (F12)                  │
│     ├─ system           settings, root helper, proxy, tray (F16, F18, F21)   │
│     └─ node-test        isolated service, own state (F20)                    │
└──────────────────────────────────────────────────────────────────────────────┘
      │ unix socket 0660 (group dvpn + ACL)      │ HTTPS             │ HTTPS (pinned)
      ▼                                          ▼                   ▼
 dvpnd (client role, root LaunchDaemon)      Solana devnet RPC    nodes / providers
 tunnel (utun) · pf kill switch · DNS ·      (user-configurable    (any listed node,
 device key · vouchers every 60 s ·           pool, failover)       any plan)
 reconnect 5×
```

- **Only the daemon is privileged.** The app runs as the user. Every root step (service setup,
  applying daemon settings, removing tunnels, driver install, uninstall cleanup, service
  control) goes through ONE bundled entry point, `resources/scripts/dvpn-helper`, which runs only
  its own whitelisted scripts (`HELPER_STEPS`) under Apple's `/bin/bash`:
  - on a desktop: `osascript … with administrator privileges` — the system password prompt, one
    per step, with our own message;
  - over SSH / CI / the test rig: `sudo -n`;
  - already root: directly.
  Only validated file paths and tokens go on the command line, never config text (M5.3 #8).
  After setup the helper runs from the root-owned copy in `/usr/local/lib/devnet-dvpn/scripts`
  (the app bundle may be writable by the user); setup itself runs from the bundle so a new app
  version installs its new scripts.
- **The service.** LaunchDaemon `/Library/LaunchDaemons/network.sentinel.devnet-dvpn.dvpnd.plist`
  (KeepAlive; `launchctl bootstrap | kickstart | bootout system`). Binaries are copied to the
  root-owned `/usr/local/lib/devnet-dvpn` with the quarantine attribute removed.
- **Network control lives in dvpnd.** Kill switch = dvpnd's pf anchor `dvpnd`, attached as the
  first rule of the main ruleset for both directions (`anchor "dvpnd" quick all`); DNS through
  `networksetup` (or `none`). The app itself only sets the per-service SOCKS proxy
  (`networksetup -setsocksfirewallproxy`) and restores the user's own values.
- **Two keys.** Owner key (the user's wallet) signs grants, subscriptions, settlement and
  withdrawals. Device key (inside dvpnd) signs channels, vouchers and node API calls, within the
  allowance the owner granted.
- **No server of ours.** The app talks to the daemon, Solana RPC, nodes and providers. Optional
  third-party calls (IP check, speed test) are listed in Settings and can be turned off.

## Source layout

Two-layer split (TypeScript rule): pure logic in `core/` (no Electron, unit-tested with real
devnet fixtures); Electron/OS glue in `main/`. Every file ≤ 500 lines, one example per module.

```
src/
  shared/            types, IPC enum + tier map, error codes, string catalogue keys
  core/
    chain/           idl (devnet IDL + deployed sizes/offsets), accounts, pdas, builders, tx, errors
    daemon/          proto + client wrapper, status mapping, close reasons
    nodes/           discovery, metadata verify, tls pin, country map
    plans/           plans, providers, tickets
    pricing/         amounts, formatting, affordability
    session/         state machine, concurrent-action rules
    settlement/      queue model, timers
    quality/         ip, speed (fallback chain), dns check
  main/
    index.ts         app lifecycle, single-instance, cleanup-first registration
    ipc.ts           handlers, input validation, tiering
    scheduler.ts     polling + streams (F5)
    wallet/          safeStorage vault (Keychain), signer
    system/          settings store, root helper (elevate.ts), system proxy, startup, tray, notifications
    node-test/       NodeTestService + adapter (F20)
    logger.ts
  cli/               the CLI (same catalogue as the app); wallet in the login Keychain (keystore.ts)
  preload/           contextBridge api
  renderer/          screens (Welcome, Connect, Nodes, Plans, Sessions, Settlements, Wallet,
                     Settings, Diagnostics, Node test), components, theme tokens
resources/scripts/   dvpn-helper + its whitelisted root steps (setup-daemon.sh, apply-daemon-config.sh,
                     remove-tunnels.sh, install-deps.sh, uninstall-cleanup.sh, service-ctl.sh)
```

Port sources for each module: [`REUSE-MAP.md`](REUSE-MAP.md).

## IPC tiers (M5.2 #1)

Every channel is tagged with its blast radius; tests prove the map matches the registered handlers.

| tier | examples |
|---|---|
| ui | theme, language, window |
| readonly | nodes, plans, balances, sessions, rpc health, doctor |
| local | settings (app store), favourites, history export, system proxy |
| privileged | daemon settings apply, service restart, restore network |
| spend | connect (opens channel), subscribe, settle, withdraw, top up, grant, send |

`spend` handlers always show the cost or effect first and require an explicit confirm from the
renderer; they serialise per owner key so two writes never race a blockhash (PM `tx.js`
`broadcastQueue`).

## Data at rest

| data | where |
|---|---|
| owner secret (app) | `~/Library/Application Support/Devnet dVPN/wallet.secret` (safeStorage; key in the login Keychain item "Devnet dVPN Safe Storage") |
| owner secret (CLI) | login Keychain generic password; the secret goes to `/usr/bin/security` on stdin, never argv |
| app settings, favourites, history, settlement queue, node cache | `~/Library/Application Support/Devnet dVPN/*.json` |
| node-test runs | `~/Library/Application Support/Devnet dVPN/node-tests/` |
| logs | `~/Library/Application Support/Devnet dVPN/logs/` (rotating, redacted); service log `/Library/Logs/DevnetDVPN/dvpnd.log` |
| daemon config, device key, daemon db | `/var/db/dvpnd/client/` (daemon-owned: root:dvpn 0750 + an ACL for the setup user; `keys/` closed to the user) |

Every persisted model round-trips through JSON (bigints as strings) — tested (F13.6).
