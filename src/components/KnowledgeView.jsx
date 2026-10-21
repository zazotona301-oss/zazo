import { useState, useEffect } from 'react'
import { IconDownload, IconTrash, IconPlus, IconSave, IconClose } from './Icons'
import {
  fetchKnowledgeEntries,
  addKnowledgeEntry,
  deleteKnowledgeEntry,
  downloadJSONL,
} from '../lib/api'

export default function KnowledgeView({ onToast }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ instruction: '', context: '', response: '', tags: '' })

  useEffect(() => {
    loadEntries()
  }, [])

  async function loadEntries() {
    setLoading(true)
    try {
      const data = await fetchKnowledgeEntries()
      setEntries(data)
    } catch {
      onToast('فشل تحميل المدخلات', true)
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd() {
    if (!form.instruction.trim() || !form.response.trim()) {
      onToast('التعليمة والاستجابة مطلوبتان', true)
      return
    }

    const tags = form.tags
      .split(/[,،]/)
      .map((t) => t.trim())
      .filter(Boolean)

    try {
      await addKnowledgeEntry({
        instruction: form.instruction.trim(),
        context: form.context.trim(),
        response: form.response.trim(),
        tags,
      })
      setForm({ instruction: '', context: '', response: '', tags: '' })
      setShowModal(false)
      onToast('تمت إضافة المدخل المعرفي')
      loadEntries()
    } catch {
      onToast('فشل إضافة المدخل', true)
    }
  }

  async function handleDelete(id) {
    try {
      await deleteKnowledgeEntry(id)
      setEntries((prev) => prev.filter((e) => e.id !== id))
      onToast('تم حذف المدخل')
    } catch {
      onToast('فشل الحذف', true)
    }
  }

  function handleExport() {
    if (entries.length === 0) {
      onToast('لا توجد مدخلات للتصدير', true)
      return
    }
    downloadJSONL(entries)
    onToast(`تم تصدير ${entries.length} عينة بصيغة JSONL`)
  }

  return (
    <>
      <div className="main-header">
        <h2>قاعدة المعرفة</h2>
        <div className="header-actions">
          <button className="header-btn" onClick={handleExport}>
            <IconDownload /> تصدير JSONL
          </button>
          <button
            className="header-btn"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
            onClick={() => setShowModal(true)}
          >
            <IconPlus /> إضافة مدخل
          </button>
        </div>
      </div>

      <div className="kb-container">
        <div className="kb-header">
          <div className="kb-stats">
            <div className="kb-stat">
              <strong>{entries.length}</strong> إجمالي العينات
            </div>
            <div className="kb-stat">
              <strong>{countUniqueTags(entries)}</strong> وسوم فريدة
            </div>
          </div>
        </div>

        {loading ? (
          <div className="kb-empty"><p>جارٍ التحميل...</p></div>
        ) : entries.length === 0 ? (
          <div className="kb-empty">
            <h3>لا توجد مدخلات بعد</h3>
            <p>أضف مدخلات معرفية يدوياً، أو صدّرها من المحادثات لاحقاً.</p>
          </div>
        ) : (
          <div className="kb-grid">
            {entries.map((entry) => (
              <div key={entry.id} className="kb-card">
                <div className="kb-card-field">
                  <span className="kb-card-label">التعليمة (Instruction)</span>
                  <span className="kb-card-value">{entry.instruction}</span>
                </div>
                {entry.context && (
                  <div className="kb-card-field">
                    <span className="kb-card-label">السياق (Context)</span>
                    <span className="kb-card-value">{entry.context}</span>
                  </div>
                )}
                <div className="kb-card-field">
                  <span className="kb-card-label">الاستجابة (Response)</span>
                  <span className="kb-card-value">{entry.response}</span>
                </div>
                {entry.tags && entry.tags.length > 0 && (
                  <div className="kb-tags">
                    {entry.tags.map((tag, i) => (
                      <span key={i} className="kb-tag">{tag}</span>
                    ))}
                  </div>
                )}
                <div className="kb-card-actions">
                  <span className="kb-date">
                    {new Date(entry.created_at).toLocaleDateString('ar-EG')}
                  </span>
                  <button className="kb-delete" onClick={() => handleDelete(entry.id)}>
                    <IconTrash />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>إضافة مدخل معرفي</h3>
            <div className="modal-field">
              <label>التعليمة (Instruction) *</label>
              <textarea
                value={form.instruction}
                onChange={(e) => setForm({ ...form, instruction: e.target.value })}
                placeholder="ما الذي تريد تعليمه للنموذج؟"
              />
            </div>
            <div className="modal-field">
              <label>السياق (Context)</label>
              <textarea
                value={form.context}
                onChange={(e) => setForm({ ...form, context: e.target.value })}
                placeholder="سياق إضافي (اختياري)"
              />
            </div>
            <div className="modal-field">
              <label>الاستجابة (Response) *</label>
              <textarea
                value={form.response}
                onChange={(e) => setForm({ ...form, response: e.target.value })}
                placeholder="الاستجابة المتوقعة"
                style={{ minHeight: '100px' }}
              />
            </div>
            <div className="modal-field">
              <label>الوسوم (Tags) — افصل بفاصلة</label>
              <input
                type="text"
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="react, robotics, control"
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowModal(false)}>
                إلغاء
              </button>
              <button className="btn-primary" onClick={handleAdd}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <IconSave size={16} /> حفظ
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function countUniqueTags(entries) {
  const set = new Set()
  entries.forEach((e) => (e.tags || []).forEach((t) => set.add(t)))
  return set.size
}
