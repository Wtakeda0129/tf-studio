#!/usr/bin/env bash
# Build test DMGs on Linux (no Apple tools): ad-hoc sign with rcodesign, pack with xorrisofs, convert with libdmg-hfsplus `dmg`.
# Real releases should be built on macOS (GitHub Actions) with a Developer ID signature + notarization — see DESKTOP_README.md.
set -euo pipefail
RCS=${RCODESIGN:-rcodesign}; DMGTOOL=${DMGTOOL:-dmg}
VER=$(node -p "require('./package.json').version"); NAME="Tf Studio"
for arch in arm64 x64; do
  dir=dist/mac-$arch; [ "$arch" = x64 ] && dir=dist/mac
  app="$dir/$NAME.app"; [ -d "$app" ] || { echo "skip $arch (no $app)"; continue; }
  "$RCS" sign "$app" >/dev/null 2>&1
  stage=$(mktemp -d); cp -a "$app" "$stage/"; ln -s /Applications "$stage/Applications"
  iso=$(mktemp -u).iso
  xorrisofs -D -l -V "$NAME $VER" -no-pad -r -dir-mode 0755 -o "$iso" "$stage" 2>/dev/null
  "$DMGTOOL" "$iso" "dist/$NAME-$VER-$arch.dmg" >/dev/null
  rm -rf "$stage" "$iso"; echo "built dist/$NAME-$VER-$arch.dmg"
done
