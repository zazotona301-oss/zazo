import { useState, useEffect } from 'react'
import ChatView from './components/ChatView'
import KnowledgeView from './components/KnowledgeView'
import AnalyticsView from './components/AnalyticsView'
import ConsciousnessView from './components/ConsciousnessView'
import LoraUploadView from './components/LoraUploadView'
import TrainingView from './components/TrainingView'
import {
  IconChat,
  IconCpu,
  IconBrain,
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
  subscribeSyncStatus,
} from './lib/api'

function formatTransferBytes(value) {
  if (!Number.isFinite(value) || value < 0) return ''
  const units = ['B', 'MB', 'GB']
  let amount = value
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

const transferStageLabels = {
  selecting: 'اختيار الملف',
  searching: 'فحص المستودع',
  choosing: 'اختر ملف النموذج',
  downloading: 'جارٍ التنزيل',
  installing: 'جارٍ التثبيت',
  completed: 'اكتمل النقل والتثبيت',
  error: 'فشل النقل أو التثبيت',
  cancelled: 'تم الإلغاء',
}

export default function App() {
  const [view, setView] = useState('chat')
  const [conversations, setConversations] = useState([])
  const [activeConversation, setActiveConversation] = useState(null)
  const [loadingConvos, setLoadingConvos] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [modelTransfer, setModelTransfer] = useState(null)
  const [syncStatus, setSyncStatus] = useState({ online: navigator.onLine, pending: 0, syncing: false })
  const [localModelAvailable, setLocalModelAvailable] = useState(() => Boolean(globalThis.AndroidZazoLocal?.isAvailable?.()))

  useEffect(() => {
    loadConversations()
    return subscribeSyncStatus(setSyncStatus)
  }, [])

  useEffect(() => {
    const refreshLocalModel = () => setLocalModelAvailable(Boolean(globalThis.AndroidZazoLocal?.isAvailable?.()))
    const updateTransfer = (event) => setModelTransfer(event.detail || null)
    globalThis.addEventListener?.('zazo-local-model-ready', refreshLocalModel)
    globalThis.addEventListener?.('zazo-model-transfer', updateTransfer)
    return () => {
      globalThis.removeEventListener?.('zazo-local-model-ready', refreshLocalModel)
      globalThis.removeEventListener?.('zazo-model-transfer', updateTransfer)
    }
  }, [])

  function chooseLocalModel() {
    if (typeof globalThis.AndroidZazoLocal?.chooseModel !== 'function') {
      setModelTransfer({ source: 'phone', stage: 'error', message: 'تثبيت النموذج من الهاتف متاح داخل تطبيق Android فقط.' })
      return
    }
    setModelTransfer({ source: 'phone', stage: 'selecting', message: 'اختر ملف .task أو ملف ZIP من الهاتف، أو ملفي base.bin وlora.bin.' })
    globalThis.AndroidZazoLocal.chooseModel()
  }

  function chooseHuggingFaceModel() {
    const bridge = globalThis.AndroidZazoLocal
    if (typeof bridge?.chooseHuggingFaceModel !== 'function') {
      setModelTransfer({ source: 'huggingface', stage: 'error', message: 'تنزيل النماذج من Hugging Face متاح داخل تطبيق Android فقط.' })
      return
    }
    setModelTransfer({ source: 'huggingface', stage: 'selecting', message: 'أدخل معرّف المستودع العام، ثم اختر ملف .task للتنزيل.' })
    const callbackName = `__zazoHfModel_${Date.now()}_${Math.random().toString(36).slice(2)}`
    globalThis[callbackName] = (payload) => {
      delete globalThis[callbackName]
      try {
        const result = JSON.parse(payload)
        setModelTransfer({
          source: 'huggingface',
          stage: result.ok ? 'completed' : 'error',
          message: result.message || (result.ok ? 'تم تثبيت النموذج.' : 'تعذر تثبيت النموذج.'),
        })
        if (result.ok) setLocalModelAvailable(true)
      } catch {
        setModelTransfer({ source: 'huggingface', stage: 'error', message: 'تعذر قراءة نتيجة تنزيل النموذج.' })
      }
    }
    bridge.chooseHuggingFaceModel(callbackName)
  }

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
      return convo
    } catch {
      showToast('فشل إنشاء محادثة', true)
      throw new Error('conversation creation failed')
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
          <img className="logo logo-avatar" src="/assets/zazo-avatar.webp" alt="وجه Zazo" />
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
            <img className="nav-image" src="/assets/zazo-brain-icon.webp" alt="" aria-hidden="true" /> قاعدة المعرفة
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
          <button
            className={`nav-item ${view === 'training' ? 'active' : ''}`}
            onClick={() => {
              setView('training')
              setSidebarOpen(false)
            }}
          >
            <IconBrain /> تجهيز التدريب العربي
          </button>
          <button
            className={`nav-item ${view === 'lora-upload' ? 'active' : ''}`}
            onClick={() => {
              setView('lora-upload')
              setSidebarOpen(false)
            }}
          >
            <IconCpu /> تدريب Zazo / رفع LoRA
          </button>
          <button className="nav-item" type="button" onClick={chooseLocalModel}>
            <IconCpu /> {localModelAvailable ? 'حزمة النموذج المحلي مثبتة' : 'تثبيت حزمة أوزان Android ZIP'}
          </button>
          <button className="nav-item" type="button" onClick={chooseHuggingFaceModel}>
            <IconCpu /> تنزيل نموذج MediaPipe من Hugging Face
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
        {(!syncStatus.online || syncStatus.pending > 0 || syncStatus.syncing) && <div className={`offline-status ${syncStatus.online ? 'online' : 'offline'}`}>
          {!syncStatus.online ? 'لا يوجد اتصال — الحفظ محلياً وستتم المزامنة تلقائياً عند عودة الإنترنت' : syncStatus.syncing ? 'جارٍ مزامنة البيانات...' : `بيانات محفوظة محلياً بانتظار المزامنة: ${syncStatus.pending}`}
        </div>}
        {view === 'chat' ? (
          <ChatView
            conversation={activeConversation}
            onToast={showToast}
            onConversationCreated={handleNewConversation}
          />
        ) : view === 'knowledge' ? (
          <KnowledgeView onToast={showToast} />
        ) : view === 'analytics' ? (
          <AnalyticsView onToast={showToast} />
        ) : view === 'training' ? (
          <TrainingView onToast={showToast} onNavigate={setView} />
        ) : view === 'lora-upload' ? (
          <LoraUploadView onToast={showToast} />
        ) : (
          <ConsciousnessView onToast={showToast} />
        )}
      </main>

      {toast && (
        <div className={`toast ${toast.isError ? 'error' : ''}`}>
          {toast.message}
        </div>
      )}

      {modelTransfer && (
        <section className={`model-transfer-card ${modelTransfer.stage}`} role="status" aria-live="polite">
          <div className="model-transfer-heading">
            <strong>{transferStageLabels[modelTransfer.stage] || 'حالة النموذج'}</strong>
            <button type="button" aria-label="إغلاق حالة النقل" onClick={() => setModelTransfer(null)}>×</button>
          </div>
          <p>{modelTransfer.message}</p>
          {modelTransfer.fileName && <div className="model-transfer-file">الملف: {modelTransfer.fileName}</div>}
          {(modelTransfer.stage === 'searching' || modelTransfer.stage === 'downloading' || modelTransfer.stage === 'installing' || modelTransfer.stage === 'selecting') && (
            <div className="model-transfer-progress" aria-label="تقدم العملية">
              <div
                className={typeof modelTransfer.percent === 'number' ? '' : 'indeterminate'}
                style={typeof modelTransfer.percent === 'number' ? { width: `${modelTransfer.percent}%` } : undefined}
              />
            </div>
          )}
          {(modelTransfer.stage === 'downloading' || modelTransfer.transferredBytes != null) && (
            <div className="model-transfer-details">
              {typeof modelTransfer.percent === 'number' && <span>{modelTransfer.percent}%</span>}
              {modelTransfer.transferredBytes != null && (
                <span>
                  {formatTransferBytes(modelTransfer.transferredBytes)}
                  {modelTransfer.totalBytes != null ? ` / ${formatTransferBytes(modelTransfer.totalBytes)}` : ' تم تنزيله'}
                </span>
              )}
              <span>{modelTransfer.source === 'huggingface' ? 'من Hugging Face' : 'من الهاتف'}</span>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
