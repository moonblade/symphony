#!/usr/bin/env tsx
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { copyFileSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

function buildStyles(): void {
  const distDir = join(rootDir, 'dist/ui');

  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
  }

  const tailwindInput = join(rootDir, 'src/ui/tailwind.css');
  const destStyles = join(distDir, 'styles.css');

  if (existsSync(tailwindInput)) {
    const tailwindBin = join(rootDir, 'node_modules/.bin/tailwindcss');
    execFileSync(tailwindBin, ['-i', tailwindInput, '-o', destStyles], {
      cwd: rootDir,
      stdio: 'inherit',
    });
    console.log('Built styles.css with Tailwind CSS');
  } else {
    const srcStyles = join(rootDir, 'src/ui/styles.css');
    if (existsSync(srcStyles)) {
      copyFileSync(srcStyles, destStyles);
      console.log('Copied styles.css to dist/ui/');
    }
  }
}

const isWatch = process.argv.includes('--watch');

const buildOptions: esbuild.BuildOptions = {
  entryPoints: [join(rootDir, 'src/ui/index.tsx')],
  bundle: true,
  outfile: join(rootDir, 'dist/ui/bundle.js'),
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: !isWatch,
  sourcemap: isWatch,
  loader: {
    '.tsx': 'tsx',
    '.ts': 'ts',
  },
  define: {
    'process.env.NODE_ENV': isWatch ? '"development"' : '"production"',
  },
};

async function build(): Promise<void> {
  try {
    buildStyles();
    if (isWatch) {
      const ctx = await esbuild.context(buildOptions);
      
      // Properly dispose context on process termination
      const cleanup = (): void => {
        ctx.dispose().then(() => process.exit(0)).catch(() => process.exit(1));
      };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
      
      await ctx.watch();
      console.log('Watching for changes...');
    } else {
      await esbuild.build(buildOptions);
      // Write build nonce for cache busting (changes on each build)
      const nonce = Date.now().toString(36);
      writeFileSync(join(rootDir, 'dist/ui/.build-nonce'), nonce);
      console.log(`UI bundle built successfully (nonce: ${nonce})`);
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
