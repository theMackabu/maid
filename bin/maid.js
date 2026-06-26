#!/usr/bin/env node
const entry = new URL('../src/main.ts', import.meta.url).href;

if (isPlainNode()) {
  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  await jiti.import(entry);
} else {
  await import(entry);
}

function isPlainNode() {
  return (
    typeof process !== 'undefined' &&
    Boolean(process.versions?.node) &&
    !Boolean(process.versions?.bun) &&
    !Boolean(process.versions?.ant) &&
    typeof globalThis.Deno === 'undefined'
  );
}
