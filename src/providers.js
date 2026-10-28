import { errorJson } from './config.js'

export const DEFAULT_CHAT_PATH = '/chat/completions'
export const DEFAULT_MODELS_PATH = '/models'
export const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b'

export function normalizeBaseUrl(input) {
  const raw = String(input || '').trim()
  if (!raw) throw new Error('請填寫 Base URL')
  let url
  try { url = new URL(raw) } catch { throw new Error('Base URL 格式不正確') }
  if (url.protocol !== 'https:') throw new Error('Base URL 必須使用 HTTPS')
  if (url.username || url.password) throw new Error('Base URL 不可包含帳號密碼')
  if (url.hash || url.search) throw new Error('Base URL 不可包含查詢字串或片段')
  if (isBlockedHost(url.hostname)) throw new Error('此主機位址不被允許')
  return url.toString().replace(/\/+$/, '')
}

export function isBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa') || host.endsWith('.lan')) return true
  if (host === '0.0.0.0' || host === '::' || host === '::1') return true
  if (host.startsWith('::ffff:')) return isBlockedHost(host.slice(7))
  // IPv6 link-local and unique-local ranges only. Do not reject ordinary
  // hostnames that happen to begin with "fc" or "fd".
  if (host.includes(':') && (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd'))) return true
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number)
    if ([a, b, c, d].some((n) => n > 255)) return true
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a >= 224) return true
  }
  return false
}

export function chatCompletionsUrl(baseUrl) {
  const base = normalizeBaseUrl(baseUrl)
  if (/\/chat\/completions$/i.test(base)) return base
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

export function modelsUrl(baseUrl) {
  const base = normalizeBaseUrl(baseUrl)
  if (/\/models$/i.test(base)) return base
  if (/\/v1$/i.test(base)) return `${base}/models`
  return `${base}/v1/models`
}

export function providerFromBody(body, env = {}) {
  const p = body && typeof body.provider === 'object' ? body.provider : null
  const baseUrl = p ? p.baseUrl : (body && body.baseUrl)
  const apiKey = p ? p.apiKey : (body && body.apiKey)
  const model = p ? p.model : (body && body.model)
  const explicit = !!(p || baseUrl || apiKey)

  if (!explicit) {
    // Single-owner deployments may set a server-side Groq key. This is only a
    // fallback: an explicitly configured browser provider always wins.
    if (env.GROQ_API_KEY) {
      return {
        baseUrl: normalizeBaseUrl(env.GROQ_BASE_URL || DEFAULT_GROQ_BASE_URL),
        apiKey: String(env.GROQ_API_KEY),
        model: String(model || env.GROQ_MODEL || DEFAULT_GROQ_MODEL).trim().slice(0, 200),
      }
    }
    throw new Error('請先在設定中新增供應商，或設定 GROQ_API_KEY')
  }

  if (!baseUrl) throw new Error('請先在設定中新增供應商')
  if (!apiKey || String(apiKey).length < 8) throw new Error('供應商 API Key 無效')
  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKey: String(apiKey),
    model: String(model || '').trim().slice(0, 200),
  }
}

export function upstreamHeaders(apiKey) {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream, application/json',
    'User-Agent': 'personal-ai/1.0',
  }
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 120_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)
  const onAbort = () => controller.abort('client-abort')
  if (options.signal) {
    if (options.signal.aborted) controller.abort('client-abort')
    else options.signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    if (options.signal) options.signal.removeEventListener('abort', onAbort)
  }
}

export async function readJsonLimited(response, maxBytes = 200_000) {
  const text = await response.text()
  if (text.length > maxBytes) throw new Error('上游回應過大')
  try { return JSON.parse(text) } catch { throw new Error('上游回應不是有效 JSON') }
}

export function providerError(status, detail = '') {
  const message = detail ? `供應商錯誤：${detail}` : `供應商回傳 HTTP ${status}`
  return errorJson(message, status === 401 || status === 403 ? 400 : 502, 'provider_error')
}