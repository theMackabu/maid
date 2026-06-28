#[path = "build/artifact.rs"]
mod artifact;

#[path = "build/bundle.rs"]
mod bundle;

#[path = "build/package.rs"]
mod package;

#[path = "build/util.rs"]
mod util;

use std::{env, path::PathBuf};

fn main() {
  let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
  let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());

  package::emit_rerun_rules();
  artifact::download_ant(&out_dir);
  let version = package::version(&manifest_dir);

  bundle::build(&manifest_dir, "src/main.ts", &out_dir.join("maid-main.mjs"), &version);
  bundle::build(&manifest_dir, "src/sandbox-run.ts", &out_dir.join("maid-sandbox-run.mjs"), &version);
}
