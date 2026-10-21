import { useState, useEffect, useRef } from 'react'
import { IconSend } from './Icons'
import { fetchMessages, addMessage, renameConversation } from '../lib/api'

export default function ChatView({ conversation, onToast }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState('')
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    if (!conversation) return
    setLoading(true)
    setMessages([])
    fetchMessages(conversation.id)
      .then((data) => {
        setMessages(data)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
        onToast('فشل تحميل الرسائل', true)
      })
  }, [conversation?.id])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || !conversation) return

    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    const userMsg = await addMessage(conversation.id, 'user', text)
    setMessages((prev) => [...prev, userMsg])

    const response = generateResponse(text)
    const assistantMsg = await addMessage(
      conversation.id,
      'assistant',
      response.content,
      response.metadata
    )
    setMessages((prev) => [...prev, assistantMsg])
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

  if (!conversation) {
    return (
      <div className="empty-chat">
        <div className="logo">Z</div>
        <h3>وعي Zazo</h3>
        <p>أنا وعي Zazo، جاهز لاستقبال أول أمر برمجي أو طلب لبناء واجهة.</p>
        <p className="consciousness-chat-note">الواجهة تسجل وتصنّف الرسائل تجريبياً؛ محرك LLM وربط الروبوت يحتاجان إعداد خدمة خلفية.</p>
      </div>
    )
  }

  return (
    <>
      <div className="main-header">
        {editingTitle ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: 1 }}>
            <input
              className="chat-input"
              style={{ flex: 1, minHeight: '40px', padding: '8px 12px' }}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
              autoFocus
            />
            <button className="btn-primary" onClick={handleSaveTitle}>حفظ</button>
            <button className="btn-secondary" onClick={() => setEditingTitle(false)}>إلغاء</button>
          </div>
        ) : (
          <h2
            style={{ cursor: 'pointer' }}
            onClick={() => {
              setTitle(conversation.title)
              setEditingTitle(true)
            }}
          >
            {conversation.title}
          </h2>
        )}
      </div>

      <div className="chat-container">
        {loading ? (
          <div className="empty-chat"><p>جارٍ التحميل...</p></div>
        ) : messages.length === 0 ? (
          <div className="empty-chat">
            <div className="logo">Z</div>
            <h3>أهلاً بك في وعي Zazo</h3>
            <p>اكتب أول أمر برمجي أو طلب لبناء واجهة.</p>
            <p className="consciousness-chat-note">الردود الحالية تحليل تجريبي محلي وليست ناتجة عن نموذج LLM متصل.</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`message ${msg.role}`}>
              <div className="message-role">
                {msg.role === 'user' ? 'أنت' : 'Zazo'}
              </div>
              {msg.content}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <div className="chat-input-wrapper">
          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder="اكتب رسالتك هنا... (Enter للإرسال، Shift+Enter لسطر جديد)"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              autoResize()
            }}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={!input.trim()}
          >
            <IconSend />
          </button>
        </div>
      </div>
    </>
  )
}

function generateResponse(userInput) {
  const keywords = extractKeywords(userInput)
  const intent = detectIntent(userInput)

  return {
    content: `أنا وعي Zazo. وصلتني رسالتك وسُجّلت.\n\nتحليل الواجهة التجريبي:\nالهدف المكتشف: ${intent}\nالكلمات المفتاحية: ${keywords.join('، ') || 'لا يوجد'}\n\nملاحظة تقنية: هذا تصنيف محلي بسيط، وليس استدلالاً من نموذج LLM. ربط النموذج واستدعاء الوظائف يحتاجان خدمة خلفية.`,
    metadata: { intent, keywords, source: 'zazo_brain' },
  }
}

function extractKeywords(text) {
  const stopWords = new Set(['في', 'من', 'إلى', 'على', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'what', 'the', 'a', 'an', 'is', 'are', 'how', 'to'])
  return text
    .split(/[\s,،.؟!?]+/)
    .filter((w) => w.length > 2 && !stopWords.has(w.toLowerCase()))
    .slice(0, 8)
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
