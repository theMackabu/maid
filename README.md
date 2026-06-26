# Maid

Fast local task runner for project scripts, dependencies, and cached build steps.

Maid is written in TypeScript and runs on [Ant](https://antjs.org), Node.js, Bun, Deno, and other JavaScript runtimes.

## Install

Run without installing:

```bash
antx land:maid
```

Install globally:

```bash
ant i -g land:maid
```

## Usage

```bash
maid --help
maid typecheck
```

## Maidfile

Tasks live in `maidfile` or `Maidfile.toml`:

```toml
[tasks.build]
depends = { stdout = true, tasks = ["clean"] }
script = ["ant install", "ant run typecheck"]

[tasks.clean]
script = "rm -rf dist"
```

Dependencies are quiet by default. Use `stdout = true` or `output = true` when a
dependency should show its command output.

### Scripts with logic

Start a `script` with a shebang to run the whole block as one program — real
control flow, no nested `bash -c '...'`:

```toml
[tasks.deploy]
script = '''
#!/usr/bin/env bash
set -euo pipefail
if [[ -d dist ]]; then
  rsync -a dist/ "$DEPLOY_TARGET"
else
  echo "nothing to deploy"
fi
'''
```

Or point at a file with `file = "scripts/deploy.sh"` (resolved relative to the
maidfile). A task uses either `script` or `file`, not both.

## Development

```bash
ant install
ant src/main.ts typecheck
ant src/main.ts smoke
```
