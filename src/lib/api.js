import { supabase } from './supabase'

const backendConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
const LOCAL_CONVERSATIONS = 'zazo.local.conversations'
const LOCAL_MESSAGES = 'zazo.local.messages'

export function isBackendConfigured() {
  return backendConfigured
}

export async function fetchConversations() {
  if (!backendConfigured) return readLocal(LOCAL_CONVERSATIONS, [])
  const { data, error } = await supabase.from('conversations').select('*').order('updated_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createConversation(title = 'New Conversation') {
  if (!backendConfigured) {
    const conversation = { id: makeId(), title, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), local: true }
    writeLocal(LOCAL_CONVERSATIONS, [conversation, ...readLocal(LOCAL_CONVERSATIONS, [])])
    return conversation
  }
  const { data, error } = await supabase.from('conversations').insert({ title }).select().single()
  if (error) throw error
  return data
}

export async function deleteConversation(id) {
  if (!backendConfigured) {
    writeLocal(LOCAL_CONVERSATIONS, readLocal(LOCAL_CONVERSATIONS, []).filter((conversation) => conversation.id !== id))
    writeLocal(LOCAL_MESSAGES, readLocal(LOCAL_MESSAGES, []).filter((message) => message.conversation_id !== id))
    return
  }
  const { error } = await supabase.from('conversations').delete().eq('id', id)
  if (error) throw error
}

export async function renameConversation(id, title) {
  if (!backendConfigured) {
    const updated = readLocal(LOCAL_CONVERSATIONS, []).map((conversation) => conversation.id === id ? { ...conversation, title, updated_at: new Date().toISOString() } : conversation)
    writeLocal(LOCAL_CONVERSATIONS, updated)
    return updated.find((conversation) => conversation.id === id)
  }
  const { data, error } = await supabase.from('conversations').update({ title, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function fetchMessages(conversationId) {
  if (!backendConfigured) return readLocal(LOCAL_MESSAGES, []).filter((message) => message.conversation_id === conversationId).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function addMessage(conversationId, role, content, metadata = {}) {
  if (!backendConfigured) {
    const message = { id: makeId(), conversation_id: conversationId, role, content, metadata, created_at: new Date().toISOString(), local: true }
    writeLocal(LOCAL_MESSAGES, [...readLocal(LOCAL_MESSAGES, []), message])
    const conversations = readLocal(LOCAL_CONVERSATIONS, []).map((conversation) => conversation.id === conversationId ? { ...conversation, updated_at: message.created_at } : conversation)
    writeLocal(LOCAL_CONVERSATIONS, conversations)
    return message
  }
  const { data, error } = await supabase.from('messages').insert({ conversation_id: conversationId, role, content, metadata }).select().single()
  if (error) throw error
  await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId)
  return data
}

export async function requestAssistantResponse({ conversationId, messages, mode = 'chat' }) {
  if (!backendConfigured) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.functions.invoke('zazo-chat', { body: { conversation_id: conversationId, messages, mode } })
  if (error) throw error
  if (!data?.content) throw new Error('Empty assistant response')
  return data
}

export async function fetchKnowledgeEntries() {
  const { data, error } = await supabase.from('knowledge_entries').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function addKnowledgeEntry(entry) {
  const { data, error } = await supabase.from('knowledge_entries').insert(entry).select().single()
  if (error) throw error
  return data
}

export async function addKnowledgeEntries(entries) {
  if (!entries.length) return []
  const { data, error } = await supabase.from('knowledge_entries').insert(entries).select()
  if (error) throw error
  return data
}

export async function deleteKnowledgeEntry(id) {
  const { error } = await supabase.from('knowledge_entries').delete().eq('id', id)
  if (error) throw error
}

export async function fetchAllMessages() {
  const { data, error } = await supabase.from('messages').select('*, conversations!inner(title)').order('created_at', { ascending: false })
  if (error) throw error
  return data
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

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)) } catch { return fallback }
}

function writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private browsing may block storage */ }
}
