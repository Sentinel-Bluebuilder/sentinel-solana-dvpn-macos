#!/bin/bash
# ─── Install the VPN service from a home the app already initialised (F1.5, macOS, cb33) ───
# Order matters: sentinel-dvpnd refuses to start until its device key holds a grant, so the app first
# runs `sentinel-dvpnd init --instance c0` as the user into a staging folder, the owner signs device
# setup, and only then this step runs as root (one prompt) to: create the socket group and add the
# user, copy the home into the real instance dir /Library/Application Support/sentinel-dvpn/c0, lock
# the key folder to root, copy the binaries + Homebrew tools the service runs into root-owned
# /usr/local/lib/devnet-dvpn, write + load our own LaunchDaemon (root-owned PATH, so finding 1 of the
# cb33 launchd PATH issue cannot apply here), link the CLI, and delete the staging copy (it holds the
# device secret).
# The daemon runs `run --instance c0` with NO --home, so it reads the real instance dir and gives its
# control socket the group — cb33 has no socket_group config key.
# Args: --Dvpnd --Staging --DaemonHome --BinRoot --Group --Service [--Instance] [--Label] [--User] [--Cli] --Result
set -uo pipefail
HERE="$(cd -P "$(dirname "$0")" && pwd -P)"
source "$HERE/_lib.sh"
parse_args "$@"
DVPND="${ARG_Dvpnd:-}"; STAGING="${ARG_Staging:-}"; HOME_DIR="${ARG_DaemonHome:-}"
BIN_ROOT="${ARG_BinRoot:-}"; GROUP="${ARG_Group:-sentinel-dvpn}"; USER_NAME="${ARG_User:-}"; CLI="${ARG_Cli:-}"
INSTANCE="${ARG_Instance:-c0}"
LABEL="${ARG_Label:-$LABEL}"; PLIST="/Library/LaunchDaemons/$LABEL.plist"

[ -f "$DVPND" ] && [ -x "$DVPND" ] || die "sentinel-dvpnd not found at $DVPND"
[ "$(basename "$DVPND")" = sentinel-dvpnd ] || die 'unexpected daemon binary name'
[[ "$INSTANCE" =~ ^c[0-9]+$ ]] || die "bad instance tag $INSTANCE"
under "$HOME_DIR" "$DAEMON_ROOT" || die "daemon home must be under $DAEMON_ROOT"
[[ "$GROUP" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "bad group name $GROUP"
if [ -n "$USER_NAME" ]; then id -u "$USER_NAME" >/dev/null 2>&1 || die "no such user $USER_NAME"; fi
# Staging is deleted as root at the end: only ever the app's own daemon-staging folder, no link.
if [ -n "$STAGING" ]; then
  [[ "$STAGING" == /Users/?*/daemon-staging ]] || die "unexpected staging folder $STAGING"
  [[ "$STAGING" != *..* ]] && [ ! -L "$STAGING" ] || die "unsafe staging folder $STAGING"
fi

# 1. socket group + the desktop user in it; an inherited ACL on the home gives THIS user access to
#    the socket sentinel-dvpnd re-creates on every start (macOS resolves the new membership at once too).
dseditgroup -o read "$GROUP" >/dev/null 2>&1 || dseditgroup -o create -r 'Devnet dVPN' "$GROUP" || die "could not create group $GROUP"
if [ -n "$USER_NAME" ]; then dseditgroup -o edit -a "$USER_NAME" -t user "$GROUP" || die "could not add $USER_NAME to $GROUP"; fi

# 2. the home
# A wallet switch stages a NEW operator key while the service home still holds the old one (fleet bug
# W1): keeping the old home would lose the new key and leave the service on the old device. When the
# staged key differs, the old home is moved aside (kept: it may still hold deposits to settle).
# cb33 names the key "operator" (a home from before cb33 said "device").
device_key() { "$DVPND" key list --instance "$INSTANCE" --home "$1" 2>/dev/null | grep -oE '"name":"(operator|device)","public_key":"[1-9A-HJ-NP-Za-km-z]{32,44}"' | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}"' | tr -d '"' | head -1; }
if [ -f "$HOME_DIR/config.toml" ] && [ -n "$STAGING" ] && [ -f "$STAGING/config.toml" ]; then
  staged_key=$(device_key "$STAGING"); installed_key=$(device_key "$HOME_DIR")
  if [ -n "$staged_key" ] && [ "$staged_key" != "$installed_key" ]; then
    svc_stop || die 'could not stop the VPN service to replace its device'
    prev="$HOME_DIR.prev-$(date -u +%Y%m%dT%H%M%SZ)"
    mv "$HOME_DIR" "$prev" || die 'could not move the old service home aside'
    echo "replaced device ${installed_key:-unknown} with $staged_key; old home kept at $prev" >&2
  fi
fi
if [ ! -f "$HOME_DIR/config.toml" ]; then
  [ -f "$STAGING/config.toml" ] || die "staging home has no config.toml: $STAGING"
  mkdir -p "$HOME_DIR"
  cp -Rp "$STAGING/." "$HOME_DIR/" || die 'could not copy the staged home'
fi
# a home kept from an older sentinel-dvpnd (reinstall) may still carry pre-cb33 key names / a stray
# socket_group; the migrate step brings its one config.toml up to the cb33 shape (no-op if already so).
/bin/bash "$HERE/migrate-daemon-config.sh" --DaemonHome "$HOME_DIR" >/dev/null || die 'could not update the service settings to the cb33 layout'
chown -R root:"$GROUP" "$DAEMON_ROOT"
# closed to other users: the group (and below, the setup user by ACL before a new login) gets in
chmod 750 "$DAEMON_ROOT"
# `sentinel-dvpnd doctor` wants the instance home 0750 (so a group member can reach the socket path),
# every config SUBdir 0700 and config.toml 0600 (root only). The setup user reaches them through the
# ACLs granted below. Match doctor exactly so it prints no notes.
chmod 750 "$HOME_DIR"
find "$HOME_DIR" -mindepth 1 -type d ! -path '*/keys' ! -path '*/keys/*' -exec chmod 700 {} +
find "$HOME_DIR" -name config.toml ! -path '*/keys/*' -exec chmod 600 {} +
for k in "$HOME_DIR/keys" "$HOME_DIR/client/keys"; do
  if [ -d "$k" ]; then chown -R root:wheel "$k"; chmod -R go-rwx "$k"; fi
done
# the device ADDRESS (public half) for the app: the key folder itself stays root-only
PUB=$("$DVPND" key list --instance "$INSTANCE" --home "$HOME_DIR" 2>/dev/null | grep -oE '"name":"(operator|device)","public_key":"[1-9A-HJ-NP-Za-km-z]{32,44}"' | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}"$' | tr -d '"')
[ -n "$PUB" ] || die 'could not read the device public key'
printf '%s\n' "$PUB" > "$HOME_DIR/device.pub" && chmod 600 "$HOME_DIR/device.pub"
# the database holds signed vouchers, plan tickets and the session history: root only. A home
# from an older setup has it 0644 (launchd's default umask; the plist now sets 077).
find "$HOME_DIR" -name 'data.db*' -type f -exec chmod 600 {} +
if [ -n "$USER_NAME" ]; then
  chmod -N "$DAEMON_ROOT" 2>/dev/null
  chmod +a "user:$USER_NAME allow search,readattr" "$DAEMON_ROOT" || die 'could not grant the home folder ACL'
  chmod -N "$HOME_DIR" 2>/dev/null
  chmod +a "user:$USER_NAME allow list,search,read,write,readattr,readextattr,file_inherit" "$HOME_DIR" || die 'could not grant the socket ACL'
  find "$HOME_DIR" -mindepth 1 -type d ! -path '*/keys' ! -path '*/keys/*' -exec chmod +a "user:$USER_NAME allow list,search,readattr" {} + 2>/dev/null
  find "$HOME_DIR" -name config.toml ! -path '*/keys/*' -exec chmod +a "user:$USER_NAME allow read,readattr" {} + 2>/dev/null
  # device.pub is the device ADDRESS the app shows; base mode is 0600, so grant the setup user a read ACE
  [ -f "$HOME_DIR/device.pub" ] && chmod +a "user:$USER_NAME allow read,readattr" "$HOME_DIR/device.pub" 2>/dev/null
fi

# 3. root-owned copies of everything the service runs. The app bundle can be replaced on update
#    or be writable by the user; Homebrew's prefix is user-writable. Root must not exec either.
install -d -m 755 "$LIB" "$LIB/tools" || die "could not create $LIB"
install -m 755 "$DVPND" "$LIB/sentinel-dvpnd.new" && mv -f "$LIB/sentinel-dvpnd.new" "$LIB/sentinel-dvpnd" || die 'could not install sentinel-dvpnd'
for d in v2ray xray hysteria2; do
  if [ -n "$BIN_ROOT" ] && [ -d "$BIN_ROOT/$d" ]; then
    rm -rf "$LIB/$d.new" && cp -R "$BIN_ROOT/$d" "$LIB/$d.new" && rm -rf "$LIB/$d" && mv "$LIB/$d.new" "$LIB/$d" || die "could not install $d"
  fi
done
/bin/bash "$HERE/install-deps.sh" --CopyOnly 1 ${USER_NAME:+--User "$USER_NAME"} >/dev/null 2>&1
# the helper scripts too: later prompts run these root-owned copies, not the app bundle's
rm -rf "$LIB/scripts.new" && cp -R "$HERE" "$LIB/scripts.new" && rm -rf "$LIB/scripts" && mv "$LIB/scripts.new" "$LIB/scripts" || die 'could not install the helper scripts'
chown -R root:wheel "$LIB"; chmod -R go-w "$LIB"
xattr -dr com.apple.quarantine "$LIB" 2>/dev/null
DVPND="$LIB/sentinel-dvpnd"
# cb33 upgrade (DIR 11-08): the install root moved to "$LIB" (/Library/devnet-dvpn, every parent
# root:wheel, no space). Two predecessors existed: /usr/local/lib/devnet-dvpn (uid-501 ancestor on
# Homebrew-Intel — the trusted-path check refused its own binaries on connect) and a short-lived
# "/Library/Application Support/devnet-dvpn" (its space broke wg-quick). Remove any of them so an
# upgrade is not left with a stale tool tree (the new PATH never points there).
for LEGACY_LIB in /usr/local/lib/devnet-dvpn "/Library/Application Support/devnet-dvpn"; do
  if [ "$LEGACY_LIB" != "$LIB" ] && [ -d "$LEGACY_LIB" ]; then
    rm -rf "$LEGACY_LIB" 2>/dev/null || echo "note: could not remove the legacy tools dir $LEGACY_LIB" >&2
  fi
done

# 4. LaunchDaemon (OURS, not `sentinel-dvpnd service install`). The daemon finds wg-quick /
#    wireguard-go / openvpn / v2ray / xray / hysteria2 on PATH: only our root-owned copies, never a
#    user-writable Homebrew dir (cb33 launchd-PATH finding 1). `run --instance c0` with no --home, so
#    the daemon reads the real instance dir and gives its socket the group. SIGTERM stop = the daemon
#    ends the session and releases the kill switch. A device without its grant fails preflight on
#    every start: ThrottleInterval keeps the retries (each costs RPC calls) one minute apart.
SVC_PATH="$LIB/tools"
for d in v2ray xray hysteria2; do [ -d "$LIB/$d" ] && SVC_PATH="$SVC_PATH:$LIB/$d"; done
SVC_PATH="$SVC_PATH:/usr/bin:/bin:/usr/sbin:/sbin"
install -d -m 755 "$LOG_DIR"
svc_stop
cat > "$PLIST.new" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Written by Devnet dVPN (setup-daemon.sh). Removed by its uninstaller. -->
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$DVPND</string><string>run</string><string>--instance</string><string>$INSTANCE</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$SVC_PATH</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>ExitTimeOut</key><integer>30</integer>
  <key>ProcessType</key><string>Interactive</string>
  <!-- 077: what the daemon creates itself (its database) is root only; it sets the socket mode itself -->
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/dvpnd.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/dvpnd.log</string>
</dict>
</plist>
PL
plutil -lint "$PLIST.new" >/dev/null || die 'the LaunchDaemon file is not valid'
chown root:wheel "$PLIST.new"; chmod 644 "$PLIST.new"; mv -f "$PLIST.new" "$PLIST"
# cb33 upgrade: the pre-cb33 app used a different launchd label; boot out and remove its plist so the
# machine is not left with two Devnet dVPN LaunchDaemons after an install-over (ours is $LABEL).
OLD_LABEL="network.sentinel.devnet-dvpn.dvpnd"
OLD_PLIST="/Library/LaunchDaemons/$OLD_LABEL.plist"
if [ "$OLD_LABEL" != "$LABEL" ] && [ -f "$OLD_PLIST" ]; then
  launchctl bootout "system/$OLD_LABEL" 2>/dev/null || true
  rm -f "$OLD_PLIST"
fi
# cb33 upgrade: a pre-cb33 build left its pf kill-switch anchor named 'dvpnd', and an abnormally
# stopped daemon can leave 'sentinel-dvpn-<tag>' attached. The daemon refuses to attach over a
# conflicting anchor ("conflicting pf anchor attachment") and fails closed, so KS-on connects abort
# until the stale attach is gone. Empty our anchors and, only if a stale attach line is present, drop
# ONLY our line and reload the rest (the daemon re-attaches its own on connect). Matches the daemon's
# attachAnchor. Never `pfctl -f /etc/pf.conf` (discards another program's runtime rules — a second VPN,
# a Little Snitch-style tool — QA 11-08), never `pfctl -F all`/`-d`.
if [ "$(uname)" = Darwin ]; then
  pfctl -a dvpnd -F all >/dev/null 2>&1 || true
  pfctl -a "sentinel-dvpn-$INSTANCE" -F all >/dev/null 2>&1 || true
  rules="$(pfctl -sr 2>/dev/null)"
  if printf '%s\n' "$rules" | grep -qE '^anchor "(dvpnd|sentinel-dvpn-)'; then
    printf '%s\n' "$rules" | grep -vE '^anchor "(dvpnd|sentinel-dvpn-)' | pfctl -R -f - >/dev/null 2>&1 || true
  fi
fi
LOG_AT=$(stat -f %z "$LOG_DIR/dvpnd.log" 2>/dev/null || echo 0)
svc_start || die "service failed to start: $(svc_log_tail 3)"
OFFLINE=0
if ! wait_socket "$HOME_DIR/daemon.sock"; then
  # the daemon checks the RPC before it serves (unless a kill switch is held). With no network it
  # exits and launchd starts it again every minute (KeepAlive), so it comes up once the network is back.
  tail -c +$((LOG_AT + 1)) "$LOG_DIR/dvpnd.log" 2>/dev/null | grep -q 'preflight failed: rpc' || die "service started but its control socket did not appear: $(svc_log_tail 3)"
  OFFLINE=1
fi

# 5. the CLI on PATH (the .dmg has no post-install step)
if [ -n "$CLI" ] && [ -f "$CLI" ] && [ "$(basename "$CLI")" = devnet-dvpn ]; then
  install -d -m 755 /usr/local/bin && ln -sf "$CLI" /usr/local/bin/devnet-dvpn
fi
[ -n "$STAGING" ] && [ -d "$STAGING" ] && rm -rf -- "$STAGING"
if [ "$OFFLINE" = 1 ]; then write_result ok 'service installed; waiting for the network' '"waitingForNetwork":true'; else write_result ok 'service installed and running'; fi
