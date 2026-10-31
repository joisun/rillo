import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

import { isCodexModelSlug, isCodexReasoningLevel } from './codex-model-selection.mjs'
import { validateCadence } from './cadence.mjs'
import { THREAD_MODES, validAutoCompactLimit } from '../session-policy.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ETAG = /^[0-9a-f]{64}$/
const SANDBOXES = new Set(['read-only', 'workspace-write', 'danger-full-access'])
const SPEC_KEYS = new Set(['job_id', 'definition_etag', 'title', 'prompt', 'workspace', 'cadence', 'timezone_mode', 'thread_mode', 'sandbox_mode', 'model', 'reasoning_effort', 'timeout_seconds'])

function fail() { return Object.assign(new Error('CODEX_INVOCATION_INVALID'), { code: 'CODEX_INVOCATION_INVALID' }) }
function string(value, max) { return typeof value === 'string' && value.length > 0 && value.length <= max }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) }
function validCadence(value) {
  if (!object(value) || value.timezone_mode !== 'system') return false
  try { validateCadence(value, { allowPastOnce: true }); return true } catch { return false }
}
async function canonicalFile(value) {
  if (!string(value, 4096) || !isAbsolute(value)) throw fail()
  try {
    const path = await realpath(value); const metadata = await stat(path)
    if (!isAbsolute(path) || !metadata.isFile() || (metadata.mode & 0o111) === 0) throw fail()
    return path
  } catch (error) { throw error?.code === 'CODEX_INVOCATION_INVALID' ? error : fail() }
}
async function canonicalDirectory(value) {
  if (!string(value, 4096) || !isAbsolute(value)) throw fail()
  try {
    const path = await realpath(value)
    if (!isAbsolute(path) || !(await stat(path)).isDirectory()) throw fail()
    return path
  } catch (error) { throw error?.code === 'CODEX_INVOCATION_INVALID' ? error : fail() }
}
function validateSnapshot(spec) {
  if (!object(spec) || [...SPEC_KEYS].some((key) => !Object.hasOwn(spec, key)) || Object.keys(spec).some((key) => !SPEC_KEYS.has(key) && !['fast_mode', 'network_access', 'resume_session_id', 'auto_compact_token_limit'].includes(key))) throw fail()
  if (!string(spec.job_id, 36) || !UUID.test(spec.job_id) || !string(spec.definition_etag, 64) || !ETAG.test(spec.definition_etag)
    || !string(spec.title, 512) || !string(spec.prompt, 64 * 1024) || !validCadence(spec.cadence)
    || spec.timezone_mode !== 'system' || !THREAD_MODES.has(spec.thread_mode) || !SANDBOXES.has(spec.sandbox_mode)
    || !Number.isSafeInteger(spec.timeout_seconds) || spec.timeout_seconds < 60 || spec.timeout_seconds > 86400) throw fail()
  if (spec.network_access != null && typeof spec.network_access !== 'boolean') throw fail()
  if (spec.fast_mode != null && typeof spec.fast_mode !== 'boolean') throw fail()
  if (!validAutoCompactLimit(spec.auto_compact_token_limit)) throw fail()
  if (spec.resume_session_id != null && (!string(spec.resume_session_id, 36) || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(spec.resume_session_id) || spec.thread_mode === 'new')) throw fail()
  if (spec.model !== null && (!string(spec.model, 128) || !isCodexModelSlug(spec.model))) throw fail()
  if (spec.reasoning_effort !== null && (!string(spec.reasoning_effort, 16) || !isCodexReasoningLevel(spec.reasoning_effort))) throw fail()
}

export async function buildCodexInvocation(claimedSpec, { codexPath } = {}) {
  validateSnapshot(claimedSpec)
  const [command, cwd] = await Promise.all([canonicalFile(codexPath), canonicalDirectory(claimedSpec.workspace)])
  const args = [
    'exec', '--json', '--color', 'never', '--skip-git-repo-check',
    '--sandbox', claimedSpec.sandbox_mode, '--cd', cwd,
    '-c', 'approval_policy="never"',
  ]
  if (claimedSpec.model !== null) args.push('--model', claimedSpec.model)
  if (claimedSpec.reasoning_effort !== null) args.push('-c', `model_reasoning_effort="${claimedSpec.reasoning_effort}"`)
  if (claimedSpec.fast_mode != null) args.push('-c', `service_tier="${claimedSpec.fast_mode ? 'fast' : 'default'}"`)
  if (claimedSpec.network_access != null) args.push('-c', `sandbox_workspace_write.network_access=${claimedSpec.network_access}`)
  if (claimedSpec.auto_compact_token_limit != null) args.push('-c', `model_auto_compact_token_limit=${claimedSpec.auto_compact_token_limit}`)
  if (claimedSpec.resume_session_id) args.push('resume', claimedSpec.resume_session_id)
  args.push('-')
  return Object.freeze({ command, args: Object.freeze(args), cwd, stdin: claimedSpec.prompt, timeout_ms: claimedSpec.timeout_seconds * 1000 })
}
