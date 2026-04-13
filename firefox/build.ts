import { build, context } from 'esbuild'

const isWatch = process.argv.includes('--watch')

const buildOptions = {
  entryPoints: ['src/background.ts'],
  bundle: true,
  outdir: 'dist',
  format: 'iife' as const,
  platform: 'browser' as const,
  target: 'firefox115',
  sourcemap: true,
  minify: false,
  logLevel: 'info' as const
}

if (isWatch) {
  const ctx = await context(buildOptions)
  await ctx.watch()
  console.log('Watching for changes...')
} else {
  await build(buildOptions)
}
