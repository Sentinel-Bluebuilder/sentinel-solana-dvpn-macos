# Changelog

## 0.3.0-rc2 - pre-release (2026-11-14)

- Daemon on the Sentinel Solana fork cut `final6.16`.
- Signed with one stable self-signed identity instead of ad hoc, so every build carries the same signature requirement. Still not notarized: the first time, right-click the app and choose Open.
- Start-up window guard: if the window has not loaded and drawn 5 s after a start-up show, the page is reloaded once (fixes a blank window at log-in).
- Kill switch on: the app starts at log-in, and a block held at start shows the window with "Internet blocked by the kill switch" and Restore network.
- "StartSession: Connection dropped" is shown in plain words, with Restore network.
- Known issues: see the README.

## 0.1.3 - final release (2026-11-09)

- Daemon repinned to the Sentinel Solana fork cut `final6.5` (`90014b2`): status fails fast (2 s) while the service restarts, a tunnel that receives nothing is reported within 2 s, no false "Reconnecting" in long soaks, and status reads "Reconnecting" during the kill-switch hold (Q0469, Q0445, Q0480, Q0459).
- Ad-hoc signed, not notarized. The version number is unchanged from the release candidates.

## 0.1.3 - RC2 (2026-11-09)

- Built on the Sentinel Solana fork cut `final6.1` (`02b22fc`); app revision includes the RPC config writer fix (Q0468, Q0478).
- Ad-hoc signed, not notarized. The version number is unchanged from RC1.

## 0.1.3 - RC1 (2026-11-08)

- First release candidate for macOS (x64 and arm64), on fork cut `final6.1`.
