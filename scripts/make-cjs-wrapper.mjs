// Emits a one-line CJS re-export wrapper so `require('ohlc-resample')` keeps
// working against the ESM build. Node's synchronous `require(esm)` (stable
// since 23.7) loads ./dist/index.js and its ESM graph (including hyparquet)
// with no top-level await, so both `require` and `import` resolve to the SAME
// module instance — no dual-package hazard.
import { writeFileSync } from 'node:fs';

writeFileSync(
  new URL('../dist/index.cjs', import.meta.url),
  "module.exports = require('./index.js');\n",
);
