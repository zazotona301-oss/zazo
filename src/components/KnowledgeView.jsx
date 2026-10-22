import { useState, useEffect, useRef } from 'react'
import { IconDownload, IconTrash, IconPlus, IconSave, IconClose, IconUpload, IconMic } from './Icons'
import { fetchWorlds, fetchKnowledgeEntries, addKnowledgeEntry, addKnowledgeEntries, deleteKnowledgeEntry, downloadJSONL, transcribeAudio } from '../lib/api'
import { extractBookRecords } from '../lib/fileExtractor'

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'ogg', 'webm', 'mp4', 'mpeg']

export default function KnowledgeView({ onToast }) {
  const [entries, setEntries] = useState([])
  const [worlds, setWorlds] = useState([])
  const [selectedWorldId, setSelectedWorldId] = useState('')
  const [loading, setLoading] = useState(true)
  const [audioBusy, setAudioBusy] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [showImporter, setShowImporter] = useState(false)
  const [preview, setPreview] = useState([])
  const [sourceName, setSourceName] = useState('')
  const [form, setForm] = useState({ instruction: '', context: '', response: '', tags: '' })
  const fileRef = useRef(null)
  const audioRef = useRef(null)

  useEffect(() => { loadEntries() }, [])

  async function loadEntries() {
    setLoading(true)
    try {
      const [loadedEntries, loadedWorlds] = await Promise.all([fetchKnowledgeEntries(), fetchWorlds()])
      setEntries(loadedEntries)
      setWorlds(loadedWorlds)
      if (loadedWorlds.length && !selectedWorldId) setSelectedWorldId(loadedWorlds[0].id)
    } catch { onToast('فشل تحميل العوالم أو المدخلات', true) } finally { setLoading(false) }
  }

  async function handleAdd() {
    if (!form.instruction.trim()) { onToast('الفكرة أو التعليمة مطلوبة', true); return }
    try {
      const entry = await addKnowledgeEntry({
        instruction: form.instruction.trim(), context: form.context.trim(), response: form.response.trim(), worldId: selectedWorldId || undefined,
        tags: form.tags.split(/[,،]/).map((tag) => tag.trim()).filter(Boolean),
        metadata: { ingestion: 'manual', needs_review: !form.response.trim() },
      })
      setEntries((prev) => [entry, ...prev])
      setForm({ instruction: '', context: '', response: '', tags: '' }); setShowModal(false); onToast('تمت إضافة المدخل إلى العالم')
    } catch { onToast('فشل إضافة المدخل', true) }
  }

  async function handleFile(file) {
    if (!file) return
    const extension = file.name.toLowerCase().split('.').pop()
    setSourceName(file.name)
    try {
      if (AUDIO_EXTENSIONS.includes(extension) || file.type.startsWith('audio/')) {
        setAudioBusy(true)
        const result = await transcribeAudio(file)
        if (!result.text?.trim()) throw new Error('التفريغ الصوتي فارغ')
        setPreview([{ instruction: `محتوى صوتي: ${file.name}`, context: '', response: result.text.trim(), tags: ['audio', 'transcription'], metadata: { ingestion: 'audio_transcription', needs_review: true } }])
        setShowImporter(true)
        onToast('تم تحويل الصوت إلى نص — راجعه قبل الحفظ')
      } else {
        const parsed = await extractBookRecords(file)
        setPreview(parsed)
        setShowImporter(true)
        onToast(`تم تحليل ${parsed.length} سجل من ${file.name} — راجعها قبل الحفظ`)
      }
    } catch (error) {
      onToast(error.message || 'تعذر قراءة الملف أو الصيغة غير صحيحة', true)
    } finally { setAudioBusy(false) }
  }

  async function handleImport() {
    if (!preview.length) return
    try {
      const saved = await addKnowledgeEntries(preview.map((item) => ({ ...item, worldId: selectedWorldId || undefined, source_name: sourceName })))
      setEntries((prev) => [...saved, ...prev]); setPreview([]); setShowImporter(false); onToast(`تم حفظ ${saved.length} سجل داخل العالم`)
    } catch { onToast('فشل حفظ البيانات؛ ستبقى في الطابور المحلي عند انقطاع الاتصال', true) }
  }

  async function handleDelete(id) {
    try { await deleteKnowledgeEntry(id); setEntries((prev) => prev.filter((entry) => entry.id !== id)); onToast('تم حذف المدخل') } catch { onToast('فشل الحذف', true) }
  }

  return <>
    <div className="main-header"><h2>قاعدة المعرفة · محلل البيانات</h2><div className="header-actions">
      <select className="world-select" value={selectedWorldId} onChange={(event) => setSelectedWorldId(event.target.value)} aria-label="العالم المستهدف">
        <option value="">العالم الافتراضي</option>{worlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}
      </select>
      <button className="header-btn" onClick={() => downloadJSONL(entries)}><IconDownload /> تصدير JSONL</button>
      <button className="header-btn" onClick={() => fileRef.current?.click()}><IconUpload /> رفع كتاب / ملف</button>
      <button className="header-btn" onClick={() => audioRef.current?.click()} disabled={audioBusy}><IconMic /> {audioBusy ? 'جاري التفريغ...' : 'رفع صوت'}</button>
      <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.epub,.txt,.md,.markdown,.html,.htm,.json,.jsonl,.ndjson,.csv,.tsv" onChange={(e) => handleFile(e.target.files?.[0])} />
      <input ref={audioRef} type="file" hidden accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.mp4" onChange={(e) => handleFile(e.target.files?.[0])} />
      <button className="header-btn" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => setShowModal(true)}><IconPlus /> إدخال يدوي</button>
    </div></div>
    <div className="kb-container"><div className="kb-header"><div><p className="analyst-hint">يدعم PDF وDOCX وEPUB وHTML وJSON وCSV وMarkdown وTXT، مع تفريغ الملفات الصوتية إلى نص قبل الحفظ في العالم المختار.</p></div><div className="kb-stats"><div className="kb-stat"><strong>{entries.length}</strong> سجل</div><div className="kb-stat"><strong>{countUniqueTags(entries)}</strong> وسوم</div></div></div>
      {loading ? <div className="kb-empty"><p>جارٍ التحميل...</p></div> : entries.length === 0 ? <div className="kb-empty"><h3>لا توجد مدخلات بعد</h3><p>اكتب فكرة أو ارفع كتاباً أو محتوى صوتياً ليقوم المحلل بتجهيزه.</p></div> : <div className="kb-grid">{entries.map((entry) => <div key={entry.id} className="kb-card">
        <div className="kb-card-field"><span className="kb-card-label">التعليمة / الفكرة</span><span className="kb-card-value">{entry.instruction}</span></div>
        {entry.context && <div className="kb-card-field"><span className="kb-card-label">السياق</span><span className="kb-card-value">{entry.context}</span></div>}
        <div className="kb-card-field"><span className="kb-card-label">الاستجابة {entry.metadata?.needs_review && <em className="review-badge">تحتاج مراجعة</em>}</span><span className="kb-card-value">{entry.response || 'لم تُحدد بعد'}</span></div>
        <div className="kb-card-actions"><span className="kb-date">{entry.metadata?.source_name || new Date(entry.created_at).toLocaleDateString('ar-EG')}</span><button className="kb-delete" onClick={() => handleDelete(entry.id)}><IconTrash /></button></div>
      </div>)}</div>}
    </div>

    {showImporter && <div className="modal-overlay" onClick={() => setShowImporter(false)}><div className="modal import-modal" onClick={(e) => e.stopPropagation()}><div className="modal-title-row"><h3>معاينة المحلل · {sourceName}</h3><button className="icon-btn" onClick={() => setShowImporter(false)}><IconClose /></button></div><p className="analyst-hint">تم التعرف على {preview.length} سجل داخل العالم المختار. السجلات بدون Response ستُحفظ كأفكار تحتاج مراجعة.</p><div className="import-preview">{preview.slice(0, 20).map((item, index) => <div className="import-row" key={index}><span className="import-index">{index + 1}</span><div><strong>{item.instruction || 'بدون تعليمة'}</strong><small>{item.response || 'بدون استجابة — مراجعة مطلوبة'}</small></div><span className={item.response ? 'ready-dot' : 'review-dot'} /></div>)}</div><div className="modal-actions"><button className="btn-secondary" onClick={() => setShowImporter(false)}>إلغاء</button><button className="btn-primary" onClick={handleImport}><IconSave size={16} /> حفظ {preview.length} سجل</button></div></div></div>}
    {showModal && <div className="modal-overlay" onClick={() => setShowModal(false)}><div className="modal" onClick={(e) => e.stopPropagation()}><h3>إدخال فكرة أو عينة تدريب</h3><Field label="الفكرة / Instruction *" value={form.instruction} onChange={(value) => setForm({ ...form, instruction: value })} placeholder="ما الذي تريد تعليمه للنموذج؟" /><Field label="السياق / Context" value={form.context} onChange={(value) => setForm({ ...form, context: value })} placeholder="سياق إضافي اختياري" /><Field label="الإجابة / Response" value={form.response} onChange={(value) => setForm({ ...form, response: value })} placeholder="اتركها فارغة إن كانت فكرة تحتاج مراجعة" /><div className="modal-field"><label>وسوم</label><input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="book, arabic, audio" /></div><div className="modal-actions"><button className="btn-secondary" onClick={() => setShowModal(false)}>إلغاء</button><button className="btn-primary" onClick={handleAdd}><IconSave size={16} /> حفظ</button></div></div></div>}
  </>
}

function Field({ label, value, onChange, placeholder }) { return <div className="modal-field"><label>{label}</label><textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></div> }
function countUniqueTags(entries) { return new Set(entries.flatMap((entry) => entry.tags || [])).size }
