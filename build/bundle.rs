use std::{fs, path::Path};

pub fn copy_prebuilt(manifest_dir: &Path, filename: &str, outfile: &Path) {
  let source = manifest_dir.join("generated").join(filename);
  if !source.is_file() {
    panic!(
      "{} is missing; run `maid publish` or `build/publish.sh --prebuild-only` before building the crate",
      source.display()
    );
  }

  fs::copy(&source, outfile).unwrap_or_else(|error| panic!("failed to copy {} to {}: {error}", source.display(), outfile.display()));
}
