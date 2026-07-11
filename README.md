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

For an interactive command that should take over Maid's process, set
`exec = true`. Maid prints the command when it starts, then leaves the terminal,
signals, exit status, and lifetime to that command without printing a completion
summary afterward:

```toml
[tasks.shell]
exec = true
script = "nix develop --command zsh"
```

An exec task must contain one script and cannot be used as a dependency.

### Sandboxed tasks

Give a task a `sandbox` table and its `script` becomes an entry file run inside
an [Ant sandbox](https://antjs.org) instead of the host shell. The guest's
output streams through and its exit status becomes the task's:

```toml
[tasks.untrusted]
sandbox = { mount = ".:/workspace", write = "tmp:/tmp", cwd = "/workspace", timeoutMs = 10000 }
script = "src/test.ts"
```

`mount` is read-only and `write` is read-write (both `host:guest`, host side
resolved against the maidfile); `mount`/`write`/`forward` also accept a list.
Sandbox tasks require the Ant runtime.

## Development

```bash
ant install
ant src/main.ts typecheck
ant src/main.ts smoke
```
