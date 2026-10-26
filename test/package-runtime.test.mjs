import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

import { packageRelease } from '../scripts/package-release.mjs'

const execFileAsync = promisify(execFile)
const projectRoot = new URL('..', import.meta.url).pathname

async function availablePort() {
  const server = createServer()
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const { port } = server.address()
  await new Promise((resolveClose, reject) => server.close((error) => (
    error ? reject(error) : resolveClose()
  )))
  return port
}

async function waitForReady(url, child, stderr) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`packaged taskd exited early: ${stderr()}`)
    try {
      const response = await fetch(`${url}/health/ready`, {
        signal: AbortSignal.timeout(250),
      })
      if (response.ok && (await response.json()).ready === true) return
    } catch {
      // Retry until the condition is true or the bounded deadline expires.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
  }
  throw new Error(`packaged taskd did not become ready: ${stderr()}`)
}

async function readReadyEvent(url) {
  const response = await fetch(`${url}/api/v1/events`, {
    signal: AbortSignal.timeout(1_000),
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let source = ''
  try {
    for (let index = 0; index < 8 && !source.includes('event: ready'); index += 1) {
      const { done, value } = await reader.read()
      if (done) break
      source += decoder.decode(value, { stream: true })
    }
    return source
  } finally {
    await reader.cancel()
  }
}

function mcpExchange(script, homeDirectory) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: dirname(script),
      env: { ...process.env, HOME: homeDirectory },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const responses = []
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`packaged MCP handshake timed out: ${stderr}`))
    }, 5_000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      const lines = stdout.split('\n')
      stdout = lines.pop()
      for (const line of lines.filter(Boolean)) responses.push(JSON.parse(line))
      if (responses.some(({ id }) => id === 2)) {
        clearTimeout(timeout)
        child.stdin.end()
        child.kill('SIGTERM')
        resolveResult(responses)
      }
    })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'package-verifier', version: '1.0.0' },
      },
    })}\n`)
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0', method: 'notifications/initialized',
    })}\n`)
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    })}\n`)
  })
}

test('packaged API v5 runtime and independent session MCP bundles execute outside the source tree', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tasks-recorder-package-runtime-'))
  const outputDirectory = join(directory, 'release')
  const runtimeDirectory = join(directory, 'runtime')
  const codexDirectory = join(directory, 'codex')
  const claudeDirectory = join(directory, 'claude')
  const homeDirectory = join(directory, 'home')
  let taskd
  let taskdStderr = ''
  try {
    await Promise.all([
      mkdir(runtimeDirectory), mkdir(codexDirectory), mkdir(claudeDirectory),
      mkdir(join(homeDirectory, '.config', 'tasks-recorder'), { recursive: true }),
    ])
    await writeFile(join(homeDirectory, '.config', 'tasks-recorder', 'config.json'), JSON.stringify({
      output_dir: '.', server_host: '127.0.0.1', server_port: 43127,
    }))
    await packageRelease({ projectRoot, outputDirectory })
    await Promise.all([
      execFileAsync('tar', [
        '-xzf', join(outputDirectory, 'tasks-recorder-macos.tar.gz'), '-C', runtimeDirectory,
      ]),
      execFileAsync('tar', [
        '-xzf', join(outputDirectory, 'tasks-recorder-codex-adapter.tar.gz'), '-C', codexDirectory,
      ]),
      execFileAsync('tar', [
        '-xzf', join(outputDirectory, 'tasks-recorder-claude-adapter.tar.gz'), '-C', claudeDirectory,
      ]),
    ])

    const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
    const runtimeRoot = join(runtimeDirectory, `tasks-recorder-${manifest.version}`)
    const syntaxPaths = [
      join(runtimeRoot, 'server', 'cli.mjs'),
      join(runtimeRoot, 'server', 'taskd.mjs'),
      join(runtimeRoot, 'server', 'src', 'codex', 'importer.mjs'),
      join(codexDirectory, 'tasks-recorder', 'dist', 'mcp-server.mjs'),
      join(claudeDirectory, 'tasks-recorder', 'dist', 'mcp-server.mjs'),
    ]
    await Promise.all(syntaxPaths.map((path) => execFileAsync(process.execPath, ['--check', path])))

    const codexHome = join(directory, '.codex')
    const sessionsRoot = join(codexHome, 'sessions')
    await mkdir(sessionsRoot, { recursive: true })
    await Promise.all([
      copyFile(
        new URL('./fixtures/codex/root-session.jsonl', import.meta.url),
        join(sessionsRoot, 'root-session.jsonl'),
      ),
      copyFile(
        new URL('./fixtures/codex/child-session.jsonl', import.meta.url),
        join(sessionsRoot, 'child-session.jsonl'),
      ),
    ])
    const packagedImporter = await import(pathToFileURL(
      join(runtimeRoot, 'server', 'src', 'codex', 'importer.mjs'),
    ))
    const imported = await packagedImporter.parseCodexImport({
      sessionId: 'root-session', codexHome,
    })
    assert.equal(imported.root_turns, 2)
    assert.equal(imported.subagent_executions, 1)

    for (const adapterDirectory of [codexDirectory, claudeDirectory]) {
      const responses = await mcpExchange(
        join(adapterDirectory, 'tasks-recorder', 'dist', 'mcp-server.mjs'),
        homeDirectory,
      )
      const initialized = responses.find(({ id }) => id === 1)
      const listed = responses.find(({ id }) => id === 2)
      assert.equal(initialized.result.serverInfo.name, 'tasks-recorder')
      const names = new Set(listed.result.tools.map(({ name }) => name))
      assert.deepEqual([...names].sort(), ['session_link', 'session_sources', 'session_unlink'])
    }

    const port = await availablePort()
    const baseUrl = `http://127.0.0.1:${port}`
    await writeFile(join(homeDirectory, '.config', 'tasks-recorder', 'config.json'), JSON.stringify({
      output_dir: '.', server_host: '127.0.0.1', server_port: port,
    }))
    const workfolder = join(directory, 'workspace')
    await mkdir(workfolder)
    const databasePath = join(homeDirectory, '.config', 'tasks-recorder', 'tasks.sqlite')
    const legacyBytes = Buffer.from('legacy SQLite bytes are not opened or migrated by taskd')
    await writeFile(databasePath, legacyBytes)
    await assert.rejects(execFileAsync(process.execPath, [
      join(runtimeRoot, 'server', 'cli.mjs'), 'migrate', '--dry-run', '--database', databasePath,
    ], { cwd: runtimeRoot, env: { ...process.env, HOME: homeDirectory } }), error => error.code === 1 && /retired/.test(error.stderr))
    taskd = spawn(process.execPath, [join(runtimeRoot, 'server', 'taskd.mjs')], {
      cwd: runtimeRoot,
      env: { ...process.env, HOME: homeDirectory },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    taskd.stderr.on('data', (chunk) => { taskdStderr += chunk })
    await waitForReady(baseUrl, taskd, () => taskdStderr)
    const dashboard = await fetch(baseUrl)
    assert.equal(dashboard.status, 200)
    assert.match(await dashboard.text(), /<title>Tasks Recorder<\/title>/)
    assert.match(await readReadyEvent(baseUrl), /event: ready/)

    const meta = await fetch(`${baseUrl}/api/v1/meta`).then(response => response.json())
    assert.equal(meta.api_version, 5)
    assert.equal(meta.capabilities.session_browser, true)
    assert.equal(meta.capabilities.tasks, false)
    assert.equal((await fetch(`${baseUrl}/api/v1/session-browser/providers`)).status, 200)
    assert.equal((await fetch(`${baseUrl}/api/v1/runtimes`)).status, 200)
    assert.equal((await fetch(`${baseUrl}/api/v1/schedules`)).status, 200)
    assert.equal((await fetch(`${baseUrl}/api/v1/runs`)).status, 200)
    for (const [method, path] of [['POST', '/lifecycle/session-start'], ['GET', '/snapshot'], ['GET', '/tasks'], ['POST', '/work/context']]) {
      const response = await fetch(`${baseUrl}/api/v1${path}`, { method })
      assert.equal(response.status, 410)
      assert.equal((await response.json()).error.code, 'TASKS_RETIRED')
    }
    assert.deepEqual(await readFile(databasePath), legacyBytes)
    assert.ok((await readFile(join(homeDirectory, '.config', 'tasks-recorder', 'session-links.sqlite'))).length > 0)
    await assert.rejects(execFileAsync(process.execPath, [
      join(runtimeRoot, 'server', 'cli.mjs'), 'import', 'codex', '--session', 'root-session',
    ], { cwd: runtimeRoot, env: { ...process.env, HOME: homeDirectory } }), error => error.code === 1 && /retired/.test(error.stderr))

  } finally {
    if (taskd && taskd.exitCode === null) {
      taskd.kill('SIGTERM')
      await new Promise((resolveClose) => taskd.once('close', resolveClose))
    }
    await rm(directory, { recursive: true, force: true })
  }
})
