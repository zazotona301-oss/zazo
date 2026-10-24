import {
  countMutations,
  createLocalId,
  enqueueMutation,
  listMutations,
  readCache,
  removeMutation,
  writeCache,
} from './offlineStore'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://zazo-brain-backend.zazotona301.workers.dev').replace(/\/$/, '')
const syncListeners = new Set()
let syncRunning = false
let syncState = { online: globalThis.navigator?.onLine ?? true, pending: 0, syncing: false }

export function getApiBaseUrl() {
  return API_BASE_URL
}

export function getSyncState() {
  return syncState
}

export function subscribeSyncStatus(listener) {
  syncListeners.add(listener)
  listener(syncState)
  return () => syncListeners.delete(listener)
}

function publishSyncState(next) {
  syncState = { ...syncState, ...next }
  syncListeners.forEach((listener) => listener(syncState))
  globalThis.dispatchEvent?.(new CustomEvent('zazo-sync-status', { detail: syncState }))
}

async function refreshPending() {
  try { publishSyncState({ pending: await countMutations() }) } catch { /* IndexedDB unavailable */ }
}

async function sendNetwork(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    })
  } catch (error) {
    error.isNetworkError = true
    throw error
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `Backend request failed (${response.status})`)
    error.status = response.status
    error.isNetworkError = false
    throw error
  }
  return payload
}

async function cachedGet(path, options = {}) {
  try {
    const payload = await sendNetwork(path, options)
    await writeCache(path, payload)
    return payload
  } catch (error) {
    const cached = await readCache(path).catch(() => undefined)
    if (cached !== undefined) return cached
    throw error
  }
}

async function queueMutation(path, body, optimistic) {
  await enqueueMutation({ path, method: body ? 'POST' : 'DELETE', body: body ?? undefined })
  await refreshPending()
  publishSyncState({ syncing: false })
  return optimistic
}

async function mutate(path, method, body, optimistic, cacheUpdate) {
  try {
    const result = await sendNetwork(path, { method, body: body ? JSON.stringify(body) : undefined })
    if (cacheUpdate) await cacheUpdate(result)
    return result
  } catch (error) {
    if (!(error.isNetworkError || globalThis.navigator?.onLine === false)) throw error
    if (cacheUpdate) await cacheUpdate(optimistic)
    return queueMutation(path, body ? { ...body, __method: method } : null, optimistic)
  }
}

export async function flushOfflineQueue() {
  if (syncRunning || globalThis.navigator?.onLine === false) return
  syncRunning = true
  publishSyncState({ online: true, syncing: true })
  try {
    const mutations = await listMutations()
    for (const mutation of mutations) {
      const method = mutation.body?.__method || mutation.method
      const body = mutation.body ? { ...mutation.body } : undefined
      if (body) delete body.__method
      try {
        await sendNetwork(mutation.path, { method, body: body ? JSON.stringify(body) : undefined })
        await removeMutation(mutation.id)
      } catch (error) {
        if (error.isNetworkError) break
        await removeMutation(mutation.id)
      }
    }
  } finally {
    syncRunning = false
    await refreshPending()
    publishSyncState({ syncing: false, online: globalThis.navigator?.onLine ?? true })
  }
}

globalThis.addEventListener?.('online', () => {
  publishSyncState({ online: true })
  flushOfflineQueue()
})
globalThis.addEventListener?.('offline', () => publishSyncState({ online: false }))
setTimeout(() => { refreshPending(); flushOfflineQueue() }, 0)
setInterval(() => { if (globalThis.navigator?.onLine !== false) flushOfflineQueue() }, 30_000)

export function fetchConversations() {
  return cachedGet('/api/conversations?limit=100')
}

export function fetchWorlds() {
  return cachedGet('/api/worlds?limit=100')
}

export async function transcribeAudio(file, language = 'ar') {
  const formData = new FormData()
  formData.append('file', file, file.name || 'audio.webm')
  formData.append('language', language)
  let response
  try {
    response = await fetch(`${API_BASE_URL}/api/transcribe`, { method: 'POST', body: formData })
  } catch {
    throw new Error('لا يوجد اتصال لتحويل الصوت حالياً؛ احفظ التسجيل كنص عند عودة الإنترنت')
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || payload.error || 'تعذر تحويل الصوت إلى نص')
  return payload
}

export async function analyzeIntellectualText(text, metadata = {}) {
  const response = await fetch(`${API_BASE_URL}/api/intellectual-extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, title: metadata.title || '', authorOrSpeaker: metadata.authorOrSpeaker || '', category: metadata.category || '' }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || payload.error || 'تعذر تحليل المحتوى الفكري')
  return payload
}

export async function createConversation(title = 'محادثة جديدة') {
  const id = createLocalId()
  const optimistic = { id, title, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), offline: true }
  return mutate('/api/conversations', 'POST', { id, title }, optimistic, async (result) => {
    const current = await readCache('/api/conversations?limit=100').catch(() => []) || []
    await writeCache('/api/conversations?limit=100', [result, ...current.filter((item) => item.id !== result.id && item.id !== id)])
  })
}

export async function deleteConversation(id) {
  return mutate(`/api/conversations/${id}`, 'DELETE', null, { deleted: id, queued: true }, async () => {
    const current = await readCache('/api/conversations?limit=100').catch(() => []) || []
    await writeCache('/api/conversations?limit=100', current.filter((item) => item.id !== id))
  })
}

export async function renameConversation(id, title) {
  return mutate(`/api/conversations/${id}`, 'PUT', { title }, { id, title, queued: true }, async (result) => {
    const current = await readCache('/api/conversations?limit=100').catch(() => []) || []
    await writeCache('/api/conversations?limit=100', current.map((item) => item.id === id ? { ...item, ...result, title } : item))
  })
}

export function fetchMessages(conversationId) {
  return cachedGet(`/api/conversations/${conversationId}/messages?limit=100`)
}

export async function addMessage(conversationId, role, content, metadata = {}) {
  const id = createLocalId()
  const optimistic = { id, conversation_id: conversationId, role, content, metadata, created_at: new Date().toISOString(), offline: true }
  return mutate('/api/messages', 'POST', { id, conversationId, role, content, metadata }, optimistic, async (result) => {
    const key = `/api/conversations/${conversationId}/messages?limit=100`
    const current = await readCache(key).catch(() => []) || []
    await writeCache(key, [...current.filter((item) => item.id !== id && item.id !== result.id), result])
  })
}

export async function requestAssistantResponse({ conversationId, messages }) {
  return sendNetwork('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ conversationId, messages }),
  })
}

export async function uploadTrainingDataset({ file, uploadId, worldId }) {
  const formData = new FormData()
  formData.append('file', file, file.name)
  formData.append('uploadId', uploadId)
  if (worldId) formData.append('worldId', worldId)
  let response
  try {
    response = await fetch('/api/admin/training-upload', { method: 'POST', body: formData })
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : 'خطأ شبكة غير معروف'
    throw new Error(`تعذر الاتصال بخدمة رفع التدريب: ${reason}`)
  }
  const isJson = response.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await response.json().catch(() => ({})) : {}
  if (!isJson) throw new Error('لم يكتمل تسجيل الدخول إلى Cloudflare Access. سجّل الدخول ثم أعد الرفع.')
  if (!response.ok) {
    const rowDetails = Array.isArray(payload.invalidRows) ? ` الصفوف: ${payload.invalidRows.join('، ')}.` : ''
    throw new Error(`${payload.message || payload.error || `فشل رفع الملف (${response.status})`}${rowDetails}`)
  }
  if (!payload.success) throw new Error(payload.message || 'لم يؤكد الخادم نجاح رفع ملف التدريب')
  return payload
}

export async function uploadLoraAdapter({ configFile, weightsFile, fineTuneName }) {
  const formData = new FormData()
  formData.append('adapter_config', configFile, 'adapter_config.json')
  formData.append('adapter_model', weightsFile, 'adapter_model.safetensors')
  formData.append('name', fineTuneName)
  let response
  try {
    response = await fetch('/api/admin/lora-upload', {
      method: 'POST',
      body: formData,
    })
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : 'خطأ شبكة غير معروف'
    throw new Error(`تعذر الاتصال بخادم Zazo؛ السبب من المتصفح: ${reason}. تحقق من الاتصال وحجم الملف ثم حاول مجددًا`)
  }
  const isJson = response.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await response.json().catch(() => ({})) : {}
  if (!isJson) {
    throw new Error('لم يكتمل تسجيل الدخول إلى Cloudflare Access. افتح زر تسجيل الدخول في صفحة الرفع، ثم ارجع وأعد المحاولة.')
  }
  if (!response.ok) throw new Error(payload.message || payload.error || `فشل رفع المحول (${response.status})`)
  if (!payload.success) throw new Error(payload.message || 'لم يؤكد الخادم اكتمال رفع المحول')
  return payload
}

export async function fetchKnowledgeEntries() {
  const memories = await cachedGet('/api/memories?limit=100')
  return memories.map(normalizeMemory)
}

export async function addKnowledgeEntry(entry) {
  const id = createLocalId()
  const memoryBody = { id, ...toMemory(entry) }
  const optimistic = normalizeMemory({ id, ...memoryBody, created_at: new Date().toISOString(), offline: true })
  const memory = await mutate('/api/memories', 'POST', memoryBody, optimistic, async (result) => {
    const key = '/api/memories?limit=100'
    const current = await readCache(key).catch(() => []) || []
    await writeCache(key, [result, ...current.filter((item) => item.id !== id && item.id !== result.id)])
  })
  return normalizeMemory(memory)
}

export async function addKnowledgeEntries(entries) {
  return Promise.all(entries.map((entry) => addKnowledgeEntry(entry)))
}

export async function deleteKnowledgeEntry(id) {
  return mutate(`/api/memories/${id}`, 'DELETE', null, { deleted: id, queued: true }, async () => {
    const key = '/api/memories?limit=100'
    const current = await readCache(key).catch(() => []) || []
    await writeCache(key, current.filter((item) => item.id !== id))
  })
}

export async function fetchAllMessages() {
  const [conversations, messages] = await Promise.all([fetchConversations(), cachedGet('/api/messages?limit=1000')])
  const titles = new Map(conversations.map((conversation) => [conversation.id, conversation.title]))
  return messages.map((message) => ({ ...message, conversations: { title: titles.get(message.conversation_id) || 'محادثة' } }))
}

function toMemory(entry) {
  return {
    worldId: entry.worldId,
    roomId: entry.roomId,
    instruction: entry.instruction,
    context: entry.context || '',
    response: entry.response || '',
    metadata: { ...(entry.metadata || {}), tags: entry.tags || [], source_name: entry.source_name || entry.metadata?.source_name || 'manual' },
  }
}

function normalizeMemory(memory) {
  return {
    ...memory,
    tags: Array.isArray(memory.metadata?.tags) ? memory.metadata.tags : [],
    source_name: memory.metadata?.source_name || 'backend',
  }
}

export function exportToJSONL(entries) {
  return entries.filter((entry) => entry.instruction?.trim() && entry.response?.trim()).map((entry) => JSON.stringify({ instruction: entry.instruction, context: entry.context || '', response: entry.response, tags: entry.tags || [] })).join('\n')
}

export function downloadJSONL(entries, filename = 'zazo_dataset.jsonl') {
  const blob = new Blob([exportToJSONL(entries)], { type: 'application/jsonl' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
