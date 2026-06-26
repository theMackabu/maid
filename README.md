# Maid

Fast local task runner for project scripts, dependencies, and cached build steps.
Maid is written in TypeScript and runs on [Ant](https://antjs.org), Node.js, Bun, Deno, and other JavaScript runtimes.

## Install

Run without installing:

```bash
antx maid
```

Install globally:

```bash
ant i -g maid
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

## Development

```bash
ant install
ant src/main.ts typecheck
ant src/main.ts smoke
```
