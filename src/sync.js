import { errorJson, json } from './config.js'
import { readJsonBody, bodyErrorMessage } from './body.js'

const OWNER = 'owner'
const KEY_RE = /^(chat|doc|project|prompt|setting):[A-Za-z0-9_-]{1,100}$/
const MAX_ITEMS = 200
const MAX_VALUE = 900_000

export function syncAvailable(env) {
  return !!env.DB
}

export async function handleSync(request, env) {
  if (!env.DB) return errorJson('此部署未設定 D1，同步功能未啟用', 503, 'sync_disabled')
  if (request.method === 'GET') return pull(request, env)
  if (request.method === 'POST') return push(request, env)
  if (request.method === 'DELETE') return clear(request, env)
  return errorJson('Method not allowed', 405)
}

async function pull(request, env) {
  const url = new URL(request.url)
  const since = Math.max(0, Number.parseInt(url.searchParams.get('since') || '0', 10) || 0)
  const limit = Math.min(1000, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '500', 10) || 500))
  try {
    const { results } = await env.DB.prepare(
      `SELECT item_key, value, updated_at, deleted
         FROM sync_items
        WHERE owner_id = ? AND updated_at > ?
        ORDER BY updated_at ASC
        LIMIT ?`,
    ).bind(OWNER, since, limit).all()
    const items = (results || []).map((row) => ({
      key: row.item_key,
      value: row.value == null ? '' : row.value,
      updatedAt: Number(row.updated_at) || 0,
      deleted: !!row.deleted,
    }))
    const cursor = items.reduce((max, item) => Math.max(max, item.updatedAt), since)
    return json({ ok: true, items, cursor })
  } catch (err) {
    return errorJson('讀取同步資料失敗', 500, 'sync_read_failed')
  }
}

async function push(request, env) {
  let body
  try { body = await readJsonBody(request) } catch (err) {
    return errorJson(bodyErrorMessage(err), err.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400, 'invalid_body')
  }
  const changes = Array.isArray(body.changes) ? body.changes : null
  if (!changes) return errorJson('缺少 changes', 400, 'invalid_changes')
  if (changes.length > MAX_ITEMS) return errorJson('一次同步的項目過多', 413, 'too_many_changes')

  const rows = []
  for (const change of changes) {
    if (!change || typeof change !== 'object') continue
    const key = String(change.key || '')
    if (!KEY_RE.test(key)) return errorJson(`同步鍵不正確：${key.slice(0, 40)}`, 400, 'invalid_key')
    const deleted = !!change.deleted
    const value = deleted ? '' : String(change.value ?? '')
    if (value.length > MAX_VALUE) return errorJson(`項目過大：${key.slice(0, 40)}`, 413, 'item_too_large')
    const updatedAt = Math.max(0, Number.parseInt(change.updatedAt, 10) || 0)
    if (!updatedAt) return errorJson('同步項目缺少 updatedAt', 400, 'invalid_timestamp')
    rows.push({ key, value, updatedAt, deleted })
  }
  if (!rows.length) return json({ ok: true, applied: 0, cursor: 0 })

  try {
    const statements = rows.map((row) => env.DB.prepare(
      `INSERT INTO sync_items (owner_id, item_key, value, updated_at, deleted)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, item_key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at,
         deleted = excluded.deleted
       WHERE excluded.updated_at > sync_items.updated_at`,
    ).bind(OWNER, row.key, row.value, row.updatedAt, row.deleted ? 1 : 0))
    await env.DB.batch(statements)
    const cursor = rows.reduce((max, row) => Math.max(max, row.updatedAt), 0)
    return json({ ok: true, applied: rows.length, cursor })
  } catch (err) {
    return errorJson('寫入同步資料失敗', 500, 'sync_write_failed')
  }
}

async function clear(request, env) {
  try {
    await env.DB.prepare('DELETE FROM sync_items WHERE owner_id = ?').bind(OWNER).run()
    return json({ ok: true })
  } catch {
    return errorJson('清除同步資料失敗', 500, 'sync_clear_failed')
  }
}