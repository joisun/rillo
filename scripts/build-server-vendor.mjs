#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

export async function buildServerVendor({
  projectRoot = fileURLToPath(new URL('..', import.meta.url)),
} = {}) {
  for (const [name, contents] of [
    ['yaml', "export { parseDocument, stringify } from 'yaml'\n"],
    ['ws', "export { default } from 'ws'\n"],
    ['claude-sdk', "export { query } from '@anthropic-ai/claude-agent-sdk'\n"],
  ]) {
    const outputPath = join(projectRoot, 'server', 'vendor', `${name}.mjs`)
    const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`
    const result = await build({
      stdin: {
        contents,
        resolveDir: projectRoot,
        sourcefile: `${name}-vendor-entry.mjs`,
        loader: 'js',
      },
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node24',
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      legalComments: 'inline',
      minify: true,
      sourcemap: false,
      external: ['bufferutil', 'utf-8-validate'],
      write: false,
    })
    const [output] = result.outputFiles
    if (!output?.contents?.length) throw new Error(`${name} vendor build produced no output`)
    await mkdir(dirname(outputPath), { recursive: true })
    try {
      await writeFile(temporaryPath, output.contents, { mode: 0o644 })
      await rename(temporaryPath, outputPath)
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }
  const licensePath = join(projectRoot, 'server', 'vendor', 'CLAUDE_SDK_LICENSE.md')
  const temporaryLicense = `${licensePath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryLicense, await readFile(join(projectRoot, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'LICENSE.md')))
    await rename(temporaryLicense, licensePath)
  } finally { await rm(temporaryLicense, { force: true }) }
  return join(projectRoot, 'server', 'vendor', 'yaml.mjs')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildServerVendor().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`)
    process.exitCode = 1
  })
}
