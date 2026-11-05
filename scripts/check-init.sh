#!/usr/bin/env bash
# The repo `atrium-connector init` writes, for each sign-in kind, as a
# developer gets it: the SDK packed as npm would ship it, `init` run from that
# package, then the new repo's `bun install`, tests, typecheck and `check`.
#
# CI runs it (.github/workflows/ci.yml); run it locally the same way:
#   scripts/check-init.sh            every sign-in kind
#   scripts/check-init.sh oauth2     one
#
# While nothing is published, the written repo's pinned SDK version is checked
# as a string, then replaced by the packed tarball before `bun install`.

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
kinds=("$@")
[ ${#kinds[@]} -gt 0 ] || kinds=(pat multi-header oauth2)

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

version="$(cd "$root" && bun -e "console.log(require('./package.json').version)")"
echo "== packing @3hillsit/atrium-connector-sdk $version"
packed="$(cd "$root" && bun pm pack --quiet --destination "$work" | tail -n 1)"
tarball="$work/$(basename "$packed")"
[ -f "$tarball" ] || { echo "bun pm pack wrote no tarball" >&2; exit 1; }

# The command from the package, installed where `bunx -p` would put it.
mkdir "$work/runner"
echo '{ "name": "init-runner", "private": true }' > "$work/runner/package.json"
(cd "$work/runner" && bun add --silent "$tarball")
command="$work/runner/node_modules/.bin/atrium-connector"

for kind in "${kinds[@]}"; do
  echo "== init --sign-in $kind"
  repo="$work/repo-$kind"
  bun "$command" init "$repo" --id "smoke-$kind" --display-name "Smoke test ($kind)" --sign-in "$kind"

  pinned="$(cd "$repo" && bun -e "console.log(require('./package.json').dependencies['@3hillsit/atrium-connector-sdk'])")"
  if [ "$pinned" != "$version" ]; then
    echo "init pinned @3hillsit/atrium-connector-sdk $pinned, not the $version that ran it" >&2
    exit 1
  fi

  # The files npm could leave out of a package: a dot-file, a dot-folder.
  for file in .gitignore AGENTS.md CLAUDE.md .claude/skills/build-connector/SKILL.md atrium-builds.json; do
    [ -f "$repo/$file" ] || { echo "init wrote no $file" >&2; exit 1; }
  done

  cd "$repo"
  bun -e "
    const pkg = require('./package.json');
    pkg.dependencies['@3hillsit/atrium-connector-sdk'] = process.argv[1];
    require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n');
  " "$tarball"
  bun install --silent
  bun test
  bun run typecheck
  bunx atrium-connector check
  cd "$root"
done

echo "== init passed for: ${kinds[*]}"
