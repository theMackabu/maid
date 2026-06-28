use crate::util::js_string;
use std::{path::Path, process::Command};

pub fn build(manifest_dir: &Path, entry: &str, outfile: &Path, version: &str) {
  let banner = format!(
    "import {{ createRequire as __maidCreateRequire }} from 'node:module'; const require = __maidCreateRequire(import.meta.url); globalThis.__MAID_VERSION__ = {};",
    js_string(version)
  );

  let status = Command::new("esbuild")
    .current_dir(manifest_dir)
    .arg(entry)
    .arg("--bundle")
    .arg("--platform=node")
    .arg("--format=esm")
    .arg("--external:node:*")
    .arg("--external:ant:*")
    .arg(format!("--banner:js={banner}"))
    .arg(format!("--outfile={}", outfile.display()))
    .status()
    .unwrap_or_else(|error| panic!("failed to run esbuild for {entry}: {error}"));

  if !status.success() {
    panic!("esbuild failed for {entry}");
  }
}
