// esbuild config: bundles src/extension.ts (and all local imports) into a single
// CommonJS dist/extension.js for the VSCode extension host. Externalizes only the
// `vscode` API and Node built-ins (they resolve at runtime in the host).
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  // Keep the process alive for watch mode.
} else {
  await esbuild.build(options);
}
