# Network safety — everything that can touch this Mac's internet

The owner's rule: nothing in this app, its CLI or its tests may leave a computer
without internet. This file lists **every** code path that changes host networking on macOS,
the guard on each, and how it is tested. A new path that is not listed here is a bug.

## The paths

| # | What changes | Who changes it | When it is undone | Guard | Tested by |
|---|---|---|---|---|---|
| 1 | Tunnel (utun), routes, kill-switch pf anchor `dvpnd`, DNS (`networksetup -setdnsservers`) | `dvpnd` service only (the app never touches them) | Session stop (Disconnect, quit, Restore network); dvpnd releases a non-persist kill switch after its 5 reconnect attempts fail; StopSession releases a held kill switch even with no session | App quits only after `StopSession` (10 s cap); `Restore network` in Connect + Diagnostics + CLI `daemon restore-network` (root helper `remove-tunnels.sh`: only our utuns, the `dvpnd` anchor + its pf token, DNS from dvpnd's own backup — never `pfctl -F all`, never `pfctl -d`); `dns_revert_failed` → red banner with Restore network | Guest matrix (`scripts/e2e/mac/matrix.sh`): every case ends with the after-oracle — no pf anchor rule, no new utun, no protocol process, proxy == before, DNS == before, direct egress |
| 2 | Kill-switch **mode** (`off` / `on` / `persist`) and **allow LAN** | User, Settings → VPN service (root helper `apply-daemon-config.sh` + service restart) | User changes it back | Daemon default `on` (blocks only while a session is up or reconnecting). `persist` copy says plainly it can leave you offline. The anchor blocks both directions: from outside only replies to our allowed traffic, the tunnel, DHCP/ND, link-local and (when allowed) the LAN get in (dvpnd patch 0012) | `validateSettings` unit tests; matrix ks-on / ks-persist / ks-switch / lan; inbound proof: new SSH from the LAN fails with LAN off, works with LAN on |
| 3 | System proxy: SOCKS on every enabled network service (`networksetup -setsocksfirewallproxy`) | App, only on the user's toggle **and only while a V2Ray/Xray session exposes a loopback SOCKS endpoint** | Session end (any reason), Disconnect, Restore network, `proxy off`, app quit, next app start (crash recovery), uninstall | Refuses non-loopback endpoints; refuses with no SOCKS session; saves every service's own values to `proxy-backup.json` BEFORE changing them and restores them exactly (PAC and web proxies untouched); only undoes a service whose value is still ours | `tests/unit` (save/restore/only-ours, non-loopback refusal); matrix coverage + proxy-crash (user's own SOCKS + PAC back after a SIGKILL of dvpnd and the protocol) |
| 4 | The `dvpnd` LaunchDaemon (`network.sentinel.devnet-dvpn.dvpnd`) | One root step in first run (`setup-daemon.sh`), after device setup | `daemon uninstall` (`uninstall-cleanup.sh`): a live dvpnd is asked to stop the session first (releases a held kill switch), then bootout, anchor + token + DNS backup + our utuns removed | Reinstall never re-arms a held kill switch (8e31724) | matrix safety-armed (uninstall while persist is armed → internet direct → reinstall → nothing armed) |
| 5 | Connect on launch | App, opt-in setting | — | Once per start; never when the daemon still holds a session (adopted instead) or a previous run left a Restore-network warning; never in UI smoke runs | code review (`services/auto-connect.ts`) |
| 6 | Drivers (Homebrew wireguard-tools, wireguard-go, openvpn, bash; AmneziaWG userspace) | `install-deps.sh`, as the user for Homebrew (never root) | `repair-drivers` / uninstall | Installs tools only; changes no network setting | matrix safety-drivers |

Nothing else in the codebase changes routes, pf, interfaces, DNS or proxies. Read-only calls are
allowed (`ifconfig -l` in `tunnels.ts`, `networksetup -getdnsservers` in `dns-check.ts`,
existence checks in `install-deps.sh`). Check with:
`grep -rnE "networksetup -set|pfctl -(a|F|E|X|R|f)|route (add|delete)|ifconfig [a-z0-9]+ (destroy|down|inet)" src resources/scripts`
(expected hits: `src/main/system/proxy.ts`, `remove-tunnels.sh`, `uninstall-cleanup.sh`, and a
comment in `dns-check.ts` that describes dvpnd's own DNS backend).

## Test rules
- Paid sessions, full tunnels and the kill switch run **only** in the macOS guests on GCP
  (`test-host`, `test-host`, `test-host`), never on the owner's laptop.
- Each guest runs `ddv-deadman` every 40 s: after 3 failed checks it boots dvpnd out, kills the
  protocols, flushes pf and resets DNS and proxy. Host QMP `system_reset` is the last resort; the
  console login can be driven through QMP keys.
- Kill-switch cases keep allow LAN on so the driver's SSH stays up; the LAN-off cases run
  detached and report back.
- Faults (node blocked, UDP blocked, only TCP 443, loss / latency / bandwidth, link down, VM
  paused) are injected on the GCP host by `ddv-faultctl` against QEMU's own packets; every fault is
  timed and undoes itself.

## Known residual risks
- `persist` kill switch + a dvpnd that dies uncleanly keeps the block until the next service
  start (dvpnd re-applies, then releases on stop). Upstream gap #5 asks for a watchdog. The UI
  warns before `persist` is chosen.
- The proxy restore runs as the user who started the app or CLI; an uninstall run by another
  admin restores the services' saved values from the backup it finds, else leaves them.
- arm64 builds are built, not run (the rigs are Intel guests).
