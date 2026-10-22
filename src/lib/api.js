import { supabase } from './supabase'

export async function fetchConversations() {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createConversation(title = 'New Conversation') {
  const { data, error } = await supabase
    .from('conversations')
    .insert({ title })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteConversation(id) {
  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function renameConversation(id, title) {
  const { data, error } = await supabase
    .from('conversations')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function fetchMessages(conversationId) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function addMessage(conversationId, role, content, metadata = {}) {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, role, content, metadata })
    .select()
    .single()
  if (error) throw error

  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  return data
}

export async function requestAssistantResponse({ conversationId, messages, mode = 'chat' }) {
  const { data, error } = await supabase.functions.invoke('zazo-chat', {
    body: { conversation_id: conversationId, messages, mode },
  })
  if (error) throw error
  if (!data?.content) throw new Error('Empty assistant response')
  return data
}

export async function fetchKnowledgeEntries() {
  const { data, error } = await supabase
    .from('knowledge_entries')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function addKnowledgeEntry(entry) {
  const { data, error } = await supabase
    .from('knowledge_entries')
    .insert(entry)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function addKnowledgeEntries(entries) {
  if (!entries.length) return []
  const { data, error } = await supabase
    .from('knowledge_entries')
    .insert(entries)
    .select()
  if (error) throw error
  return data
}

export async function deleteKnowledgeEntry(id) {
  const { error } = await supabase
    .from('knowledge_entries')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function fetchAllMessages() {
  const { data, error } = await supabase
    .from('messages')
    .select('*, conversations!inner(title)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export function exportToJSONL(entries) {
  return entries
    .filter((e) => e.instruction?.trim() && e.response?.trim())
    .map((e) =>
      JSON.stringify({
        instruction: e.instruction,
        context: e.context || '',
        response: e.response,
        tags: e.tags || [],
      })
    )
    .join('\n')
}

export function downloadJSONL(entries, filename = 'zazo_dataset.jsonl') {
  const jsonl = exportToJSONL(entries)
  const blob = new Blob([jsonl], { type: 'application/jsonl' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
