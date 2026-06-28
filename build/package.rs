use crate::util::json_string_field;
use std::{fs, path::Path};

pub fn emit_rerun_rules() {
  println!("cargo:rerun-if-env-changed=MAID_ANT_MANIFEST");
  println!("cargo:rerun-if-changed=src/main.ts");
  println!("cargo:rerun-if-changed=src/sandbox-run.ts");
  println!("cargo:rerun-if-changed=package.json");
}

pub fn version(manifest_dir: &Path) -> String {
  let package_json = fs::read_to_string(manifest_dir.join("package.json")).unwrap();
  let package_version = json_string_field(&package_json, "version").unwrap_or_else(|| "0.0.0".to_string());
  let package_name = json_string_field(&package_json, "name").unwrap_or_else(|| "maid".to_string());
  format!("{package_name} {package_version}")
}
