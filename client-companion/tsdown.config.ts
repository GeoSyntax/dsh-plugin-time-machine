import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.tsx'],
  outDir: 'lib',
  format: ['esm'],
  dts: true,
  clean: true,
  external: [/^react($|\/)/, /^@deepseek-ai\//, /^dsh-plugin-time-machine\//],
})
