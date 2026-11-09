#!/bin/bash
# ─── Uninstall: leave networking exactly as it was before the app (root, macOS) ───
# Run by `devnet-dvpn daemon uninstall` / the app's Uninstall (a .dmg has no pre-remove hook):
#   1. the system SOCKS proxy back on every network service, if ours is still set (proxy-backup.json)
#   2. the service stopped gracefully (a clean stop ends the session and releases the kill switch
#      and DNS), its LaunchDaemon removed, root-owned copies and the CLI link removed
#   3. anything a dead session left (remove-tunnels.sh)
# Kept: the instance home (device key: on-chain permission + SOL; a reinstall picks it up again) and
# the sentinel-dvpn group (removing it would orphan the kept home's group owner).
# Args: [--Result]
set -uo pipefail
HERE="$(cd -P "$(dirname "$0")" && pwd -P)"
source "$HERE/_lib.sh"
parse_args "$@"
log() { echo "uninstall-cleanup: $*"; }

# 1. system proxy. Backup shape (src/main/system/proxy.ts):
#    {"ours":"socks 127.0.0.1:1080","state":{"backend":"networksetup","services":{"Wi-Fi":{"enabled":"No","server":"","port":"0"}}}}
for b in /Users/*/Library/Application\ Support/Devnet\ dVPN/proxy-backup.json; do
  [ -f "$b" ] && [ ! -L "$b" ] || continue
  rows="$(/usr/bin/osascript -l JavaScript -e 'function run(a){var o=JSON.parse($.NSString.stringWithContentsOfFileEncodingError(a[0],4,null).js);var ours=String(o.ours||"").replace("socks ","");var s=(o.state&&o.state.services)||{};return Object.keys(s).map(function(k){var v=s[k];return [k,ours,v.enabled||"No",v.server||"",v.port||"0"].join("\t")}).join("\n")}' "$b" 2>/dev/null)" || { log "unreadable proxy backup $b"; continue; }
  while IFS=$'\t' read -r svc ours en server port; do
    [ -n "$svc" ] || continue
    cur="$(networksetup -getsocksfirewallproxy "$svc" 2>/dev/null)"
    cur_en="$(printf '%s\n' "$cur" | awk -F': ' '/^Enabled/{print $2}')"
    cur_host="$(printf '%s\n' "$cur" | awk -F': ' '/^Server/{print $2}')"
    cur_port="$(printf '%s\n' "$cur" | awk -F': ' '/^Port/{print $2}')"
    if [ "$cur_en" = Yes ] && [ "$cur_host:$cur_port" = "$ours" ]; then
      if [ -n "$server" ]; then networksetup -setsocksfirewallproxy "$svc" "$server" "$port" >/dev/null 2>&1; fi
      if [ "$en" = Yes ]; then networksetup -setsocksfirewallproxystate "$svc" on; else networksetup -setsocksfirewallproxystate "$svc" off; fi
      log "system proxy restored on $svc"
    fi
  done <<< "$rows"
  rm -f "$b"
done

# 2. service
if [ -f "$PLIST" ]; then
  svc_stop
  rm -f "$PLIST"
  log 'service stopped and removed'
fi
# 3. leftovers of a dead session (before the root-owned copies go: it matches their paths)
/bin/bash "$HERE/remove-tunnels.sh" >/dev/null 2>&1 || true
if [ -L /usr/local/bin/devnet-dvpn ]; then
  case "$(readlink /usr/local/bin/devnet-dvpn)" in *Devnet\ dVPN*|*devnet-dvpn*) rm -f /usr/local/bin/devnet-dvpn ;; esac
fi
rm -rf "$LIB"
# cb33 (DIR 11-08): the tools root moved to /Library/devnet-dvpn. Remove either predecessor too
# (/usr/local/lib/devnet-dvpn and the short-lived "/Library/Application Support/devnet-dvpn") so
# uninstalling a build that was upgraded (or an old build directly) leaves nothing behind.
for LEGACY_LIB in /usr/local/lib/devnet-dvpn "/Library/Application Support/devnet-dvpn"; do
  [ "$LEGACY_LIB" != "$LIB" ] && [ -d "$LEGACY_LIB" ] && rm -rf "$LEGACY_LIB" 2>/dev/null
done
# pf: the daemon's Flush empties our anchors but leaves the `anchor "sentinel-dvpn-<tag>" quick all`
# ATTACHMENT line in the main ruleset (QA 11-08). Empty our anchors, then if a stale attach line for
# ours is present, drop ONLY our line and reload the rest — exactly what the daemon's attachAnchor does
# (pfctl -sr | drop our line | pfctl -R -f -). Never `pfctl -f /etc/pf.conf` (that discards rules another
# program — a second VPN, a Little Snitch-style tool — loaded at runtime), never `pfctl -F all`/`-d`.
if [ "$(uname)" = Darwin ]; then
  pfctl -a dvpnd -F all >/dev/null 2>&1 || true
  pfctl -a "sentinel-dvpn-c0" -F all >/dev/null 2>&1 || true
  rules="$(pfctl -sr 2>/dev/null)"
  if printf '%s\n' "$rules" | grep -qE '^anchor "(dvpnd|sentinel-dvpn-)'; then
    printf '%s\n' "$rules" | grep -vE '^anchor "(dvpnd|sentinel-dvpn-)' | pfctl -R -f - >/dev/null 2>&1 || true
  fi
fi
write_result ok 'networking restored; service removed; device key kept in the instance home'
exit 0
