use std::{
  env, fs, io,
  path::{Path, PathBuf},
  process::{Command, ExitCode},
  time::{SystemTime, UNIX_EPOCH},
};

use flate2::read::GzDecoder;

const ANT_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/ant.gz"));
const MAIN_SOURCE: &str = include_str!(concat!(env!("OUT_DIR"), "/maid-main.mjs"));
const SANDBOX_SOURCE: &str = include_str!(concat!(env!("OUT_DIR"), "/maid-sandbox-run.mjs"));

const ANT_TARGET: &str = env!("MAID_ANT_TARGET");
const ANT_VERSION: &str = env!("MAID_ANT_VERSION");
const ANT_FILENAME: &str = env!("MAID_ANT_FILENAME");
const ANT_SIZE: u64 = const_parse_u64(env!("MAID_ANT_SIZE"));
const ANT_HASH: &str = env!("MAID_ANT_HASH");

const fn const_parse_u64(value: &str) -> u64 {
  let bytes = value.as_bytes();
  let mut index = 0;
  let mut out = 0u64;
  while index < bytes.len() {
    out = out * 10 + (bytes[index] - b'0') as u64;
    index += 1;
  }
  out
}

fn main() -> ExitCode {
  match run() {
    Ok(code) => ExitCode::from(code),
    Err(error) => {
      eprintln!("maid: {error}");
      ExitCode::from(1)
    }
  }
}

fn run() -> io::Result<u8> {
  let runtime = Runtime::create()?;

  let mut command = Command::new(&runtime.ant);
  command.arg(&runtime.main).args(env::args_os().skip(1));

  let status = command.status()?;
  Ok(status.code().unwrap_or(1).try_into().unwrap_or(1))
}

struct Runtime {
  dir: PathBuf,
  ant: PathBuf,
  main: PathBuf,
}

impl Runtime {
  fn create() -> io::Result<Self> {
    let dir = create_temp_runtime_dir()?;
    let main = dir.join("maid-main.mjs");
    let sandbox = dir.join("sandbox-run.ts");

    fs::write(&main, MAIN_SOURCE.as_bytes())?;
    fs::write(&sandbox, SANDBOX_SOURCE.as_bytes())?;

    let ant = if let Some(path) = env::var_os("MAID_ANT_BIN") {
      PathBuf::from(path)
    } else {
      ensure_cached_ant()?
    };

    Ok(Self { dir, ant, main })
  }
}

impl Drop for Runtime {
  fn drop(&mut self) {
    let _ = fs::remove_dir_all(&self.dir);
  }
}

fn create_temp_runtime_dir() -> io::Result<PathBuf> {
  let root = env::var_os("MAID_ANT_TEMP_DIR").map(PathBuf::from).unwrap_or_else(env::temp_dir);
  let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|duration| duration.as_nanos()).unwrap_or(0);
  let dir = root.join(format!("maid-ant-{ANT_VERSION}-{ANT_TARGET}-{}-{stamp}", std::process::id()));
  fs::create_dir_all(&dir)?;
  Ok(dir)
}

fn ensure_cached_ant() -> io::Result<PathBuf> {
  let cache_dir = ant_cache_dir()?;
  fs::create_dir_all(&cache_dir)?;

  let ant = cache_dir.join(ANT_FILENAME);
  let metadata = cache_dir.join("metadata");
  if cached_ant_is_valid(&ant, &metadata) {
    return Ok(ant);
  }

  let tmp = cache_dir.join(format!("{ANT_FILENAME}.tmp.{}", std::process::id()));
  let tmp_metadata = cache_dir.join(format!("metadata.tmp.{}", std::process::id()));
  let _ = fs::remove_file(&tmp);
  let _ = fs::remove_file(&tmp_metadata);

  let mut decoder = GzDecoder::new(ANT_GZ);
  let mut file = fs::File::create(&tmp)?;
  io::copy(&mut decoder, &mut file)?;
  drop(file);
  make_executable(&tmp)?;

  fs::write(&tmp_metadata, ant_metadata())?;
  install_file(&tmp, &ant)?;
  install_file(&tmp_metadata, &metadata)?;

  Ok(ant)
}

fn cached_ant_is_valid(ant: &Path, metadata: &Path) -> bool {
  let Ok(file_metadata) = fs::metadata(ant) else {
    return false;
  };
  if !file_metadata.is_file() || file_metadata.len() != ANT_SIZE {
    return false;
  }
  fs::read_to_string(metadata).is_ok_and(|actual| actual == ant_metadata())
}

fn ant_metadata() -> String {
  format!("version={ANT_VERSION}\ntarget={ANT_TARGET}\nsize={ANT_SIZE}\nhash={ANT_HASH}\n")
}

fn ant_cache_dir() -> io::Result<PathBuf> {
  let root = if let Some(path) = env::var_os("MAID_ANT_CACHE_DIR") {
    PathBuf::from(path)
  } else {
    platform_ant_cache_root()?
  };

  Ok(root.join(format!("{ANT_VERSION}-{ANT_TARGET}")))
}

#[cfg(target_os = "macos")]
fn platform_ant_cache_root() -> io::Result<PathBuf> {
  home_dir().map(|home| home.join("Library").join("Caches").join("maid").join("ant"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_ant_cache_root() -> io::Result<PathBuf> {
  let cache = if let Some(path) = env::var_os("XDG_CACHE_HOME") {
    PathBuf::from(path)
  } else {
    home_dir()?.join(".cache")
  };
  Ok(cache.join("maid").join("ant"))
}

#[cfg(windows)]
fn platform_ant_cache_root() -> io::Result<PathBuf> {
  env::var_os("LOCALAPPDATA")
    .map(PathBuf::from)
    .map(|path| path.join("maid").join("cache").join("ant"))
    .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "LOCALAPPDATA is not set; set MAID_ANT_CACHE_DIR to override the Ant cache path"))
}

#[cfg(any(target_os = "macos", all(unix, not(target_os = "macos"))))]
fn home_dir() -> io::Result<PathBuf> {
  env::var_os("HOME")
    .map(PathBuf::from)
    .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "HOME is not set; set MAID_ANT_CACHE_DIR to override the Ant cache path"))
}

#[cfg(unix)]
fn install_file(from: &Path, to: &Path) -> io::Result<()> {
  fs::rename(from, to)
}

#[cfg(windows)]
fn install_file(from: &Path, to: &Path) -> io::Result<()> {
  match fs::rename(from, to) {
    Ok(()) => Ok(()),
    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
      fs::remove_file(to)?;
      fs::rename(from, to)
    }
    Err(error) => Err(error),
  }
}

#[cfg(unix)]
fn make_executable(path: &Path) -> io::Result<()> {
  use std::os::unix::fs::PermissionsExt;
  let mut permissions = fs::metadata(path)?.permissions();
  permissions.set_mode(0o755);
  fs::set_permissions(path, permissions)
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> io::Result<()> {
  Ok(())
}
