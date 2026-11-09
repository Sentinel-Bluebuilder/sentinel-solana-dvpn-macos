# Third-party notices

Devnet dVPN for macOS (MIT, see `LICENSE`) is a client for the open-source **Sentinel** protocol.
The application and its `.dmg`/`.zip` packages bundle the third-party software listed below, each
under its own license. Source for every component is available at the link given; for the GPL
components see **Written offer for source** at the end.

A machine-generated, per-release copy of the notices for the bundled protocol binaries (with the
exact versions, SHA-256 sums and the Xray modification patch) is written to
`build/THIRD-PARTY-NOTICES.txt` at package time and shipped inside the app
(`…/Contents/Resources/`). The full license text of every npm dependency is generated there too.

## Sentinel protocol

| Component | Role | License | Source |
|-----------|------|---------|--------|
| `sentinel-dvpnd` | the VPN daemon this app drives over gRPC | Apache-2.0 (the Sentinel project) | https://github.com/sentinel-official/sentinel-go-sdk |
| `daemon.proto` | the gRPC service definition the app speaks | Apache-2.0 (the Sentinel project) | https://github.com/sentinel-official |
| `dvpn.devnet.json` | the devnet protocol/chain descriptor | Apache-2.0 (the Sentinel project) | https://github.com/sentinel-official |

## Transport engines (bundled binaries)

| Component | Version | License | Source |
|-----------|---------|---------|--------|
| Xray-core | 26.3.27 | MPL-2.0 — **MODIFIED** (adds a macOS process-lookup source file; the patch ships in `build/THIRD-PARTY-NOTICES.txt` and `docs/patches/xray-0001-darwin-find-process.patch`) | https://github.com/XTLS/Xray-core/tree/v26.3.27 |
| Hysteria | 2.13.0 | MIT | https://github.com/apernet/hysteria/tree/app/v2.13.0 |
| V2Ray-core | 5.53.0 | MIT | https://github.com/v2fly/v2ray-core/tree/v5.53.0 |
| `geoip.dat`, `geosite.dat` | shipped with Xray | MIT (data files, v2fly/Loyalsoldier) | https://github.com/Loyalsoldier/v2ray-rules-dat |

## VPN tunnel tools (bundled binaries)

Installed root-owned into the app's trusted tool directory at setup; see `resources/scripts/install-deps.sh`.

| Component | License | Source |
|-----------|---------|--------|
| wireguard-go | MIT | https://git.zx2c4.com/wireguard-go |
| wireguard-tools (`wg`, `wg-quick`) | **GPL-2.0-only** | https://git.zx2c4.com/wireguard-tools |
| OpenVPN | **GPL-2.0-only** (with the OpenSSL linking exception) | https://github.com/OpenVPN/openvpn |
| GNU Bash (`wg-quick`/`awg-quick` need bash ≥ 4) | **GPL-3.0-or-later** | https://git.savannah.gnu.org/cgit/bash.git |
| AmneziaWG userspace (`amneziawg-go`) | MIT | https://github.com/amnezia-vpn/amneziawg-go (tag v3.1.20260812) |
| AmneziaWG tools (`awg`, `awg-quick`) | **GPL-2.0-only** | https://github.com/amnezia-vpn/amneziawg-tools (tag v3.1.20260812) |

## Fonts (bundled via @fontsource)

| Font | License | Source |
|------|---------|--------|
| Outfit | OFL-1.1 | https://github.com/Outfitio/Outfit-Fonts |
| JetBrains Mono | OFL-1.1 | https://github.com/JetBrains/JetBrainsMono |
| Tomorrow | OFL-1.1 | https://github.com/dvmazur/tomorrow-fonts |

## Notable npm runtime dependencies

| Package | License | Notes |
|---------|---------|-------|
| rpc-websockets | **LGPL-3.0** | Solana web3 websocket transport. Used unmodified as an npm dependency; replaceable per LGPL §6 by rebuilding `node_modules`. |

The complete list of every npm dependency and its license is generated into
`build/THIRD-PARTY-NOTICES.txt` at package time.

## Written offer for source (GPL components)

The bundled **wireguard-tools**, **OpenVPN**, **GNU Bash** and **AmneziaWG tools** are licensed under
the GNU GPL. The complete corresponding source for the exact versions shipped is the upstream source
at the tags/links above (this app builds those binaries from those pinned tags unmodified). In
addition, for three years from the date you received a package, the Devnet dVPN contributors will,
on request, provide the complete corresponding machine-readable source code for those GPL components
for a charge no more than the cost of physically performing distribution. Send the request, naming
the package version, through the project repository's issue tracker. This offer is valid to anyone
who received the software.
