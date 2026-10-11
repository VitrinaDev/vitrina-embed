// Bundle report (embed#25): gzip size of every shipped script against its
// budget. Run after `pnpm build`; exits non-zero when a budget is exceeded.
//
//   boot.global.js   — what a fast page loads BEFORE interaction (spec v3 §6.2)
//   loader.global.js — the full widget, loaded lazily by boot (or directly)
//   tag.global.js    — the combined tag (widget + Atribu tracker)
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const KB = 1024;
const budgets = {
  'boot.global.js': 2 * KB,
  'loader.global.js': 64 * KB,
  'tag.global.js': 66 * KB,
};
let failed = false;
for (const [file, budget] of Object.entries(budgets)) {
  const buf = readFileSync(dist + file);
  const gz = gzipSync(buf, { level: 9 }).length;
  const ok = gz <= budget;
  if (!ok) failed = true;
  console.log(
    `${ok ? 'ok  ' : 'OVER'} ${file.padEnd(18)} raw ${(buf.length / KB).toFixed(1).padStart(6)} KB  gzip ${(gz / KB).toFixed(1).padStart(5)} KB  budget ${(budget / KB).toFixed(0)} KB`,
  );
}
process.exit(failed ? 1 : 0);
