# Changelog

## 0.1.3 - final release (2026-11-09)

- Daemon repinned to the Sentinel Solana fork cut `final6.5` (`90014b2`): status fails fast (2 s) while the service restarts, a tunnel that receives nothing is reported within 2 s, no false "Reconnecting" in long soaks, and status reads "Reconnecting" during the kill-switch hold (Q0469, Q0445, Q0480, Q0459).
- Ad-hoc signed, not notarized. The version number is unchanged from the release candidates.

## 0.1.3 - RC2 (2026-11-09)

- Built on the Sentinel Solana fork cut `final6.1` (`02b22fc`); app revision includes the RPC config writer fix (Q0468, Q0478).
- Ad-hoc signed, not notarized. The version number is unchanged from RC1.

## 0.1.3 - RC1 (2026-11-08)

- First release candidate for macOS (x64 and arm64), on fork cut `final6.1`.
