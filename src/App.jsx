import { useState, useEffect } from 'react'
import ChatView from './components/ChatView'
import KnowledgeView from './components/KnowledgeView'
import AnalyticsView from './components/AnalyticsView'
import ConsciousnessView from './components/ConsciousnessView'
import {
  IconChat,
  IconBrain,
  IconCpu,
  IconAnalytics,
  IconPlus,
  IconTrash,
  IconMenu,
  IconClose,
} from './components/Icons'
import {
  fetchConversations,
  createConversation,
  deleteConversation,
} from './lib/api'

export default function App() {
  const [view, setView] = useState('chat')
  const [conversations, setConversations] = useState([])
  const [activeConversation, setActiveConversation] = useState(null)
  const [loadingConvos, setLoadingConvos] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    loadConversations()
  }, [])

  async function loadConversations() {
    setLoadingConvos(true)
    try {
      const data = await fetchConversations()
      setConversations(data)
      if (data.length > 0 && !activeConversation) {
        setActiveConversation(data[0])
      }
    } catch {
      showToast('فشل تحميل المحادثات', true)
    } finally {
      setLoadingConvos(false)
    }
  }

  function showToast(message, isError = false) {
    setToast({ message, isError })
    setTimeout(() => setToast(null), 3000)
  }

  async function handleNewConversation() {
    try {
      const convo = await createConversation(`محادثة ${conversations.length + 1}`)
      setConversations((prev) => [convo, ...prev])
      setActiveConversation(convo)
      setView('chat')
      setSidebarOpen(false)
    } catch {
      showToast('فشل إنشاء محادثة', true)
    }
  }

  async function handleDeleteConversation(id) {
    try {
      await deleteConversation(id)
      setConversations((prev) => prev.filter((c) => c.id !== id))
      if (activeConversation?.id === id) {
        setActiveConversation(null)
      }
      showToast('تم حذف المحادثة')
    } catch {
      showToast('فشل الحذف', true)
    }
  }

  return (
    <div className="app">
      <button
        className="mobile-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <IconClose /> : <IconMenu />}
      </button>

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo">Z</div>
          <div className="logo-text">
            <h1>Zazo Brain</h1>
            <span>العقل المركزي</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${view === 'consciousness' ? 'active' : ''}`}
            onClick={() => {
              setView('consciousness')
              setSidebarOpen(false)
            }}
          >
            <IconCpu /> وعي Zazo
          </button>
          <button
            className={`nav-item ${view === 'chat' ? 'active' : ''}`}
            onClick={() => {
              setView('chat')
              setSidebarOpen(false)
            }}
          >
            <IconChat /> المحادثات
          </button>
          <button
            className={`nav-item ${view === 'knowledge' ? 'active' : ''}`}
            onClick={() => {
              setView('knowledge')
              setSidebarOpen(false)
            }}
          >
            <IconBrain /> قاعدة المعرفة
          </button>
          <button
            className={`nav-item ${view === 'analytics' ? 'active' : ''}`}
            onClick={() => {
              setView('analytics')
              setSidebarOpen(false)
            }}
          >
            <IconAnalytics /> محرك التحليل
          </button>
        </nav>

        <div className="sidebar-section-label">المحادثات</div>

        <button className="new-chat-btn" onClick={handleNewConversation}>
          <IconPlus /> محادثة جديدة
        </button>

        <div className="conversation-list">
          {loadingConvos ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              جارٍ التحميل...
            </div>
          ) : conversations.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              لا توجد محادثات بعد
            </div>
          ) : (
            conversations.map((convo) => (
              <div
                key={convo.id}
                className={`conversation-item ${
                  activeConversation?.id === convo.id ? 'active' : ''
                }`}
                onClick={() => {
                  setActiveConversation(convo)
                  setView('chat')
                  setSidebarOpen(false)
                }}
              >
                <span className="conversation-title">{convo.title}</span>
                <button
                  className="conversation-delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteConversation(convo.id)
                  }}
                >
                  <IconTrash />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      <main className="main-area">
        {view === 'chat' ? (
          <ChatView
            conversation={activeConversation}
            onToast={showToast}
          />
        ) : view === 'knowledge' ? (
          <KnowledgeView onToast={showToast} />
        ) : view === 'analytics' ? (
          <AnalyticsView onToast={showToast} />
        ) : (
          <ConsciousnessView onToast={showToast} />
        )}
      </main>

      {toast && (
        <div className={`toast ${toast.isError ? 'error' : ''}`}>
          {toast.message}
        </div>
      )}
    </div>
  )
}
