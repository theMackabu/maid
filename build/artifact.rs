use std::{env, io::Write, path::Path, process::Command};

use crate::util::json_string_field;
use flate2::{Compression, write::GzEncoder};

const MANIFEST_URL: &str = "https://manifest.antjs.org/v1/latest";

pub fn download_ant(out_dir: &Path) {
  let target = ant_target();
  let manifest_url = env::var("MAID_ANT_MANIFEST").unwrap_or_else(|_| MANIFEST_URL.to_string());
  let manifest = fetch_text(&manifest_url);
  let entry = select_manifest_entry(&manifest, &target);
  let ant = fetch(&entry.download_url);
  let hash = fnv1a64(&ant);
  let compressed = gzip(&ant);

  std::fs::write(out_dir.join("ant.gz"), compressed).expect("failed to write compressed Ant artifact");

  println!("cargo:rustc-env=MAID_ANT_TARGET={target}");
  println!("cargo:rustc-env=MAID_ANT_VERSION={}", entry.version);
  println!("cargo:rustc-env=MAID_ANT_FILENAME={}", entry.filename);
  println!("cargo:rustc-env=MAID_ANT_SIZE={}", ant.len());
  println!("cargo:rustc-env=MAID_ANT_HASH={hash:016x}");
}

struct Artifact {
  download_url: String,
  filename: String,
  version: String,
}

fn ant_target() -> String {
  let os = env::var("CARGO_CFG_TARGET_OS").expect("CARGO_CFG_TARGET_OS is not set");
  let arch = match env::var("CARGO_CFG_TARGET_ARCH").expect("CARGO_CFG_TARGET_ARCH is not set").as_str() {
    "x86_64" => "x64",
    "aarch64" => "aarch64",
    arch => panic!("unsupported Ant target arch: {arch}"),
  };

  match os.as_str() {
    "macos" => format!("darwin-{arch}"),
    "linux" if env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("musl") => format!("linux-{arch}-musl"),
    "linux" => format!("linux-{arch}"),
    "windows" => format!("windows-{arch}"),
    os => panic!("unsupported Ant target OS: {os}"),
  }
}

fn fetch(url: &str) -> Vec<u8> {
  let output = Command::new("curl")
    .arg("-fsSL")
    .arg(url)
    .output()
    .unwrap_or_else(|error| panic!("failed to start curl for {url}: {error}"));

  if !output.status.success() {
    panic!("failed to download {url} with curl: {}", String::from_utf8_lossy(&output.stderr).trim());
  }

  output.stdout
}

fn fetch_text(url: &str) -> String {
  String::from_utf8(fetch(url)).unwrap_or_else(|error| panic!("downloaded non-UTF-8 manifest from {url}: {error}"))
}

fn select_manifest_entry(manifest: &str, target: &str) -> Artifact {
  let mut offset = 0usize;
  while let Some(relative_index) = manifest[offset..].find("\"target\"") {
    let target_index = offset + relative_index;
    offset = target_index + "\"target\"".len();

    let Some(entry) = object_around(manifest, target_index) else {
      continue;
    };
    if json_string_field(entry, "target").as_deref() != Some(target) {
      continue;
    }
    if !json_bool_field(entry, "available").unwrap_or(false) {
      panic!("Ant manifest artifact for {target} is not available");
    }

    return Artifact {
      download_url: json_string_field(entry, "download_url").unwrap_or_else(|| panic!("Ant manifest entry for {target} is missing download_url")),
      filename: json_string_field(entry, "filename").unwrap_or_else(|| default_ant_filename(target).to_string()),
      version: json_string_field(entry, "version").unwrap_or_else(|| "unknown".to_string()),
    };
  }

  panic!("Ant manifest has no artifact for {target}");
}

fn gzip(bytes: &[u8]) -> Vec<u8> {
  let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
  encoder.write_all(bytes).expect("failed to gzip Ant artifact");
  encoder.finish().expect("failed to finish gzipping Ant artifact")
}

fn object_around(source: &str, index: usize) -> Option<&str> {
  let start = source[..index].rfind('{')?;
  let mut depth = 0usize;
  let mut in_string = false;
  let mut escaped = false;

  for (offset, ch) in source[start..].char_indices() {
    if escaped {
      escaped = false;
      continue;
    }

    if in_string {
      if ch == '\\' {
        escaped = true;
      } else if ch == '"' {
        in_string = false;
      }
      continue;
    }

    match ch {
      '"' => in_string = true,
      '{' => depth += 1,
      '}' => {
        depth = depth.checked_sub(1)?;
        if depth == 0 {
          return Some(&source[start..start + offset + ch.len_utf8()]);
        }
      }
      _ => {}
    }
  }

  None
}

fn json_bool_field(source: &str, key: &str) -> Option<bool> {
  let needle = format!("\"{key}\"");
  let after_key = source.split_once(&needle)?.1;
  let after_colon = after_key.split_once(':')?.1.trim_start();
  if after_colon.starts_with("true") {
    Some(true)
  } else if after_colon.starts_with("false") {
    Some(false)
  } else {
    None
  }
}

fn default_ant_filename(target: &str) -> &'static str {
  if target.starts_with("windows-") { "ant.exe" } else { "ant" }
}

fn fnv1a64(bytes: &[u8]) -> u64 {
  let mut hash = 0xcbf29ce484222325u64;
  for byte in bytes {
    hash ^= u64::from(*byte);
    hash = hash.wrapping_mul(0x100000001b3);
  }
  hash
}
