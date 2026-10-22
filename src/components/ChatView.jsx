import { useState, useEffect, useRef } from 'react'
import { IconSend, IconMic } from './Icons'
import { fetchMessages, addMessage, renameConversation, requestAssistantResponse } from '../lib/api'

export default function ChatView({ conversation, onToast, onConversationCreated }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [listening, setListening] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState('')
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)
  const recognitionRef = useRef(null)

  useEffect(() => {
    if (!conversation) {
      setMessages([])
      setLoading(false)
      return
    }
    setLoading(true)
    setMessages([])
    fetchMessages(conversation.id)
      .then((data) => setMessages(data))
      .catch(() => onToast('فشل تحميل الرسائل', true))
      .finally(() => setLoading(false))
  }, [conversation?.id])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => () => recognitionRef.current?.stop(), [])

  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setSending(true)
    try {
      const activeConversation = conversation || await onConversationCreated?.()
      if (!activeConversation) throw new Error('conversation creation failed')
      const userMsg = await addMessage(activeConversation.id, 'user', text, { source: 'text' })
      const nextMessages = [...messages, userMsg]
      setMessages(nextMessages)
      let response
      try {
        response = await requestAssistantResponse({
          conversationId: activeConversation.id,
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
        })
      } catch {
        response = generateResponse(text)
        onToast('تم حفظ الرسالة؛ خدمة النموذج غير متاحة، استُخدم الرد المحلي')
      }
      const assistantMsg = await addMessage(activeConversation.id, 'assistant', response.content, response.metadata)
      setMessages((prev) => [...prev, assistantMsg])
    } catch {
      onToast('تعذر حفظ الرسالة', true)
    } finally {
      setSending(false)
    }
  }

  function toggleVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      onToast('الإدخال الصوتي غير مدعوم في هذا المتصفح', true)
      return
    }
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = 'ar-SA'
    recognition.interimResults = true
    recognition.continuous = false
    recognition.onstart = () => setListening(true)
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0].transcript).join('')
      setInput(transcript)
      requestAnimationFrame(autoResize)
    }
    recognition.onerror = () => {
      setListening(false)
      onToast('تعذر قراءة الصوت', true)
    }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    recognition.start()
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  async function handleSaveTitle() {
    if (!title.trim() || !conversation) return
    try {
      await renameConversation(conversation.id, title.trim())
      setEditingTitle(false)
      onToast('تم تحديث العنوان')
    } catch {
      onToast('فشل تحديث العنوان', true)
    }
  }

  return (
    <>
      <div className="main-header">
        {editingTitle ? <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: 1 }}><input className="chat-input" style={{ flex: 1, minHeight: '40px', padding: '8px 12px' }} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()} autoFocus /><button className="btn-primary" onClick={handleSaveTitle}>حفظ</button><button className="btn-secondary" onClick={() => setEditingTitle(false)}>إلغاء</button></div> : <h2 style={{ cursor: conversation ? 'pointer' : 'default' }} onClick={() => { if (conversation) { setTitle(conversation.title); setEditingTitle(true) } }}>{conversation?.title || 'محادثة جديدة'}</h2>}
      </div>
      <div className="chat-container">
        {loading ? <div className="empty-chat"><p>جارٍ التحميل...</p></div> : messages.length === 0 ? <div className="empty-chat"><div className="logo">Z</div><h3>أهلاً بك في وعي Zazo</h3><p>اكتب فكرتك أو اضغط زر الميكروفون للتحدث.</p></div> : messages.map((msg) => <div key={msg.id} className={`message ${msg.role}`}><div className="message-role">{msg.role === 'user' ? 'أنت' : 'Zazo'}</div>{msg.content}</div>)}
        {sending && <div className="typing-indicator">Zazo يفكر...</div>}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-area"><div className="chat-input-wrapper">
        <button className={`voice-btn ${listening ? 'active' : ''}`} onClick={toggleVoiceInput} title="إدخال صوتي"><IconMic /></button>
        <textarea ref={textareaRef} className="chat-input" placeholder="اكتب فكرتك أو تحدث... (Enter للإرسال)" value={input} onChange={(e) => { setInput(e.target.value); autoResize() }} onKeyDown={handleKeyDown} rows={1} />
        <button className="send-btn" onClick={handleSend} disabled={!input.trim() || sending}><IconSend /></button>
      </div></div>
    </>
  )
}

function generateResponse(userInput) {
  const keywords = extractKeywords(userInput)
  const intent = detectIntent(userInput)
  return { content: `تم استلام فكرتك وتسجيلها.\n\nالنية المكتشفة: ${intent}\nالكلمات المفتاحية: ${keywords.join('، ') || 'لا يوجد'}\n\nفعّل Supabase Edge Function باسم zazo-chat لتمرير الطلب إلى نموذجك الفعلي.`, metadata: { intent, keywords, source: 'local_fallback' } }
}

function extractKeywords(text) {
  const stopWords = new Set(['في', 'من', 'إلى', 'على', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'what', 'the', 'a', 'an', 'is', 'are', 'how', 'to'])
  return text.split(/[\s,،.؟!?]+/).filter((word) => word.length > 2 && !stopWords.has(word.toLowerCase())).slice(0, 8)
}

function detectIntent(text) {
  const lower = text.toLowerCase()
  if (/كيف|how|طريقة|شرح/.test(lower)) return 'تعليمي / شرح'
  if (/بناء|create|build|أنشئ|اصنع/.test(lower)) return 'بناء / إنشاء'
  if (/خطأ|error|bug|مشكلة|problem/.test(lower)) return 'حل مشكلات'
  if (/react|jsx|component|مكون/.test(lower)) return 'تطوير React'
  if (/robot|pi|تحكم|حركة|أمر/.test(lower)) return 'تحكم بالروبوت'
  return 'استفسار عام'
}
