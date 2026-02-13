#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: ./release.sh <version>"
  echo "Example: ./release.sh 0.2.0"
  exit 1
fi

VERSION="$1"

echo "Bumping version to $VERSION..."

# package.json
jq --arg v "$VERSION" '.version = $v' package.json > package.json.tmp && mv package.json.tmp package.json

# src-tauri/tauri.conf.json
jq --arg v "$VERSION" '.version = $v' src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp && mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json

# src-tauri/Cargo.toml
sed -i '' "s/^version = \".*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml

echo "Updated versions:"
echo "  package.json:        $(jq -r '.version' package.json)"
echo "  tauri.conf.json:     $(jq -r '.version' src-tauri/tauri.conf.json)"
echo "  Cargo.toml:          $(grep '^version' src-tauri/Cargo.toml)"

git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "v$VERSION"

git branch -D release 2>/dev/null || true
git checkout -b release
git push origin release --force
git checkout main
