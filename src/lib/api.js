const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://zazo-brain-backend.zazotona301.workers.dev').replace(/\/$/, '')

export function getApiBaseUrl() {
  return API_BASE_URL
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || payload.error || `Backend request failed (${response.status})`)
  return payload
}

export async function fetchConversations() {
  return request('/api/conversations?limit=100')
}

export async function createConversation(title = 'محادثة جديدة') {
  return request('/api/conversations', { method: 'POST', body: JSON.stringify({ title }) })
}

export async function deleteConversation(id) {
  await request(`/api/conversations/${id}`, { method: 'DELETE' })
}

export async function renameConversation(id, title) {
  return request(`/api/conversations/${id}`, { method: 'PUT', body: JSON.stringify({ title }) })
}

export async function fetchMessages(conversationId) {
  return request(`/api/conversations/${conversationId}/messages?limit=100`)
}

export async function addMessage(conversationId, role, content, metadata = {}) {
  return request('/api/messages', { method: 'POST', body: JSON.stringify({ conversationId, role, content, metadata }) })
}

export async function requestAssistantResponse() {
  throw new Error('Model inference endpoint is not configured')
}

export async function fetchKnowledgeEntries() {
  const memories = await request('/api/memories?limit=100')
  return memories.map(normalizeMemory)
}

export async function addKnowledgeEntry(entry) {
  const memory = await request('/api/memories', { method: 'POST', body: JSON.stringify(toMemory(entry)) })
  return normalizeMemory(memory)
}

export async function addKnowledgeEntries(entries) {
  const saved = await Promise.all(entries.map((entry) => addKnowledgeEntry(entry)))
  return saved
}

export async function deleteKnowledgeEntry(id) {
  await request(`/api/memories/${id}`, { method: 'DELETE' })
}

export async function fetchAllMessages() {
  const [conversations, messages] = await Promise.all([fetchConversations(), request('/api/messages?limit=1000')])
  const titles = new Map(conversations.map((conversation) => [conversation.id, conversation.title]))
  return messages.map((message) => ({ ...message, conversations: { title: titles.get(message.conversation_id) || 'محادثة' } }))
}

function toMemory(entry) {
  return {
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
