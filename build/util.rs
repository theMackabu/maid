pub fn json_string_field(source: &str, key: &str) -> Option<String> {
  let needle = format!("\"{key}\"");
  let after_key = source.split_once(&needle)?.1;
  let after_colon = after_key.split_once(':')?.1.trim_start();
  if !after_colon.starts_with('"') {
    return None;
  }

  let mut out = String::new();
  let mut escaped = false;
  for ch in after_colon[1..].chars() {
    if escaped {
      out.push(ch);
      escaped = false;
    } else if ch == '\\' {
      escaped = true;
    } else if ch == '"' {
      return Some(out);
    } else {
      out.push(ch);
    }
  }

  None
}
