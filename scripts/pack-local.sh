#!/usr/bin/env bash
# Packs built workspace packages into tarballs, so the Docker image and the Next.js examples can
# be built from this commit instead of from whatever is (or is not yet) published on npm.
# `yarn pack` rewrites `workspace:` ranges to real versions, and installing the tarballs together
# lets them satisfy each other's @worker-manager/* dependencies.
#
#   scripts/pack-local.sh <out-dir> <package> [<package>...]   e.g. docker-dist api ui cli
#
# Run `yarn build` first: the tarballs contain each package's dist/.
set -euo pipefail

out="$1"
shift
mkdir -p "$out"
out="$(cd "$out" && pwd)"

for name in "$@"; do
  yarn workspace "@worker-manager/$name" pack --out "$out/worker-manager-$name.tgz" > /dev/null
  echo "packed @worker-manager/$name -> $out/worker-manager-$name.tgz"
done
