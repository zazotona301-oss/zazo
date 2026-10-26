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
      if (userMsg.kvArchived === false) onToast('حُفظ السؤال في Neon لكن تعذرت نسخه إلى أرشيف KV', true)
      const nextMessages = [...messages, userMsg]
      setMessages(nextMessages)
      const response = await requestAssistantResponse({
        conversationId: activeConversation.id,
        messages: nextMessages.map(({ role, content }) => ({ role, content })),
      })
      const assistantMsg = await addMessage(activeConversation.id, 'assistant', response.content, response.metadata)
      if (assistantMsg.kvArchived === false) onToast('حُفظ رد Zazo في Neon لكن تعذرت نسخه إلى أرشيف KV', true)
      setMessages((prev) => [...prev, assistantMsg])
    } catch (error) {
      onToast(error?.message || 'تعذر الحصول على رد من نموذج Zazo', true)
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
        {loading ? <div className="empty-chat"><p>جارٍ التحميل...</p></div> : messages.length === 0 ? <div className="empty-chat"><img className="empty-avatar" src="/assets/zazo-avatar.webp" alt="وجه Zazo" /><h3>أهلاً بك في وعي Zazo</h3><p>اكتب فكرتك أو اضغط زر الميكروفون للتحدث.</p></div> : messages.map((msg) => <div key={msg.id} className={`message ${msg.role}`}><div className="message-role">{msg.role === 'user' ? 'أنت' : 'Zazo'}</div>{msg.content}{msg.role === 'assistant' && msg.metadata?.provider === 'android-local-model' && <div className="message-provider">النموذج المحلي على الجهاز</div>}{msg.role === 'assistant' && msg.metadata?.provider === 'cloudflare-workers-ai' && <div className="message-provider">Cloudflare Workers AI · Zazo Brain</div>}</div>)}
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
