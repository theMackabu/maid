pub fn emit_rerun_rules() {
  println!("cargo:rerun-if-env-changed=MAID_ANT_MANIFEST");
  println!("cargo:rerun-if-changed=generated/maid-main.mjs");
  println!("cargo:rerun-if-changed=generated/maid-sandbox-run.mjs");
}
