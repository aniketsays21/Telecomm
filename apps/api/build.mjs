/**
 * Production bundle for @telecomm/api.
 *
 * Workspace packages (@telecomm/db, @telecomm/shared, @telecomm/ai) publish
 * their entry points as raw .ts files via package.json `exports`. Plain Node
 * cannot execute .ts, so we bundle the entire dependency closure into a single
 * ESM file that Node can run with no source-code loader (no tsx, no ts-node).
 *
 * Everything from `dependencies` in package.json stays external — those live in
 * node_modules and there is no reason to inline them. That keeps the bundle
 * small, preserves package boundaries for stack traces, and avoids duplicating
 * native modules that resolve at import time (e.g. pg-native).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8'));

// External = anything installed via package.json dependencies. Workspace
// packages are intentionally NOT listed there (they're @telecomm/*), so they
// get inlined; every real npm dependency is left to Node's resolver.
const external = [
  ...Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@telecomm/')),
  // Optional peer deps of libraries we bundle in; leaving these external
  // matches what the API does today when run via tsx.
  'pg-native',
];

await build({
  entryPoints: [resolve(here, 'src/index.ts')],
  outfile: resolve(here, 'dist/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // ESM output that references CJS packages needs a `require` shim so bundled
  // CJS internals (e.g. bullmq's) that call `require()` at module scope keep
  // working. __dirname / __filename are NOT declared here — esbuild's CJS
  // module wrappers provide them where bundled CJS code needs them, and the
  // outer ESM scope already computes its own via import.meta.url in source.
  banner: {
    js: [
      "import { createRequire as __telecommCreateRequire } from 'node:module';",
      'const require = __telecommCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  external,
  sourcemap: 'linked',
  logLevel: 'info',
  metafile: false,
  legalComments: 'none',
});
