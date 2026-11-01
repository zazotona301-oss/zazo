import { useState, useEffect, useRef } from 'react'
import { IconDownload, IconTrash, IconPlus, IconSave, IconClose, IconUpload, IconMic } from './Icons'
import { fetchWorlds, fetchKnowledgeEntries, addKnowledgeEntry, deleteKnowledgeEntry, downloadJSONL, transcribeAudio, analyzeIntellectualText, uploadKnowledgeLibraryText } from '../lib/api'
import { extractFileText } from '../lib/fileExtractor'
import { parseTrainingSource } from '../lib/dataParser'

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'ogg', 'webm', 'mp4', 'mpeg']
const KNOWLEDGE_FILE_TYPES = '.pdf,.docx,.epub,.txt,.md,.markdown,.html,.htm,.json,.jsonl,.ndjson,.csv,.tsv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/epub+zip,text/plain,text/markdown,text/html,application/json,application/jsonl,application/x-ndjson,text/csv,text/tab-separated-values,application/octet-stream'

export default function KnowledgeView({ onToast }) {
  const [entries, setEntries] = useState([])
  const [worlds, setWorlds] = useState([])
  const [selectedWorldId, setSelectedWorldId] = useState('')
  const [loading, setLoading] = useState(true)
  const [audioBusy, setAudioBusy] = useState(false)
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [libraryUploadBusy, setLibraryUploadBusy] = useState(false)
  const [analysisJson, setAnalysisJson] = useState('')
  const [rawSourceText, setRawSourceText] = useState('')
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
      setForm({ instruction: '', context: '', response: '', tags: '' }); setShowModal(false)
      onToast(entry.kvArchived === false ? 'حُفظ المدخل في Neon لكن تعذرت نسخة KV' : 'تم حفظ المدخل في Neon وأرشفته في KV')
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
        setRawSourceText(result.text.trim())
        setPreview([{ id: crypto.randomUUID(), instruction: `محتوى صوتي: ${file.name}`, context: '', response: result.text.trim(), tags: ['audio', 'transcription'], metadata: { ingestion: 'audio_transcription', needs_review: true } }])
        setShowImporter(true)
        onToast('تم تحويل الصوت إلى نص — راجعه قبل الرفع')
      } else {
        const text = await extractFileText(file)
        setRawSourceText(text)
        const parsed = parseTrainingSource(text, file.name)
        setPreview(parsed.map((item) => ({ ...item, id: item.id || crypto.randomUUID() })))
        setShowImporter(true)
        onToast(`تم تحليل ${parsed.length} سجل من ${file.name} — راجعها قبل الرفع`)
      }
    } catch (error) {
      onToast(error.message || 'تعذر قراءة الملف أو الصيغة غير صحيحة', true)
    } finally { setAudioBusy(false) }
  }

  async function handleIntellectualAnalysis() {
    if (!rawSourceText.trim()) { onToast('لا يوجد نص للتحليل', true); return }
    setAnalysisBusy(true)
    try {
      const analysis = await analyzeIntellectualText(rawSourceText, { title: sourceName, category: worlds.find((world) => world.id === selectedWorldId)?.name || 'فلسفة ووعي' })
      setAnalysisJson(JSON.stringify(analysis, null, 2))
      const nodes = (analysis.extracted_nodes || []).map((node, index) => ({
        id: crypto.randomUUID(),
        instruction: node.concept_title || `concept_${String(index + 1).padStart(3, '0')}`,
        context: [node.core_summary, node.key_takeaway].filter(Boolean).join('\n\n'),
        response: node.original_quote || '',
        tags: Array.isArray(node.tags) ? node.tags : ['intellectual-analysis'],
        metadata: { ingestion: 'intellectual_extraction', needs_review: true, cognitive_relevance_score: node.cognitive_relevance_score, node_id: node.node_id },
      }))
      setPreview(nodes)
      onToast(`استخرج المحلل ${nodes.length} عقد فكرية — راجعها قبل الرفع`)
    } catch (error) { onToast(error.message || 'فشل التحليل الفكري', true) } finally { setAnalysisBusy(false) }
  }

  async function handleImport() {
    if (!preview.length) return
    const previewText = preview.map((item, index) => [
      `# ${index + 1}: ${item.instruction || 'بدون عنوان'}`,
      item.context?.trim() ? `السياق:\n${item.context.trim()}` : '',
      item.response?.trim() ? `الاستجابة:\n${item.response.trim()}` : '',
      item.tags?.length ? `الوسوم: ${item.tags.join('، ')}` : '',
    ].filter(Boolean).join('\n\n')).join('\n\n---\n\n')
    const text = rawSourceText.trim() || previewText
    if (!text.trim()) { onToast('لا يوجد نص مستخرج لرفعه', true); return }
    const accepted = globalThis.confirm?.(`سيُرفع النص المستخرج من «${sourceName || 'الملف'}» بصيغة TXT إلى المستودع العام zazo301/brain، وسيستطيع أي شخص رؤيته. لن يُحفظ هذا الاستيراد في Neon أو KV. هل توافق؟`)
    if (!accepted) return
    setLibraryUploadBusy(true)
    try {
      const filename = sourceName.replace(/\.[^.]+$/, '') || 'knowledge'
      const result = await uploadKnowledgeLibraryText({ text, filename })
      setPreview([]); setShowImporter(false)
      onToast(result.indexedNow ? `تم رفع النص إلى Hugging Face وفهرسته في D1. أصبح عاماً: ${result.url}` : `تم رفع النص إلى Hugging Face بنجاح؛ ستفهرسه مزامنة D1 القادمة. أصبح عاماً: ${result.url}`)
    } catch (error) { onToast(error.message || 'فشل رفع النص إلى Hugging Face', true) }
    finally { setLibraryUploadBusy(false) }
  }

  async function handleDelete(id) {
    try {
      const result = await deleteKnowledgeEntry(id)
      setEntries((prev) => prev.filter((entry) => entry.id !== id))
      onToast(result.kvDeleted === false ? 'حُذف من Neon لكن تعذرت إزالة نسخة KV الفورية' : 'حُذف من Neon ونسخة KV الفورية؛ قد يبقى في لقطة تصدير سابقة حتى انتهاء 31 يومًا')
    } catch { onToast('فشل الحذف', true) }
  }

  return <>
    <div className="main-header"><h2>قاعدة المعرفة · محلل البيانات</h2><div className="header-actions">
      <select className="world-select" value={selectedWorldId} onChange={(event) => setSelectedWorldId(event.target.value)} aria-label="العالم المستهدف">
        <option value="">العالم الافتراضي</option>{worlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}
      </select>
      <button className="header-btn" onClick={() => downloadJSONL(entries)}><IconDownload /> تصدير JSONL</button>
      <label className="header-btn upload-label"><IconUpload /> رفع كتاب / JSONL / ملف<input id="knowledge-file-input" ref={fileRef} className="native-file-input" type="file" accept={KNOWLEDGE_FILE_TYPES} onClick={(e) => { e.currentTarget.value = '' }} onChange={(e) => handleFile(e.target.files?.[0])} /></label>
      <label className={`header-btn upload-label ${audioBusy ? 'is-disabled' : ''}`} aria-disabled={audioBusy}><IconMic /> {audioBusy ? 'جاري التفريغ...' : 'رفع صوت'}<input id="knowledge-audio-input" ref={audioRef} className="native-file-input" type="file" disabled={audioBusy} accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.mp4,.flac" onClick={(e) => { e.currentTarget.value = '' }} onChange={(e) => handleFile(e.target.files?.[0])} /></label>
      <button className="header-btn" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => setShowModal(true)}><IconPlus /> إدخال يدوي</button>
    </div></div>
    <div className="kb-container"><div className="kb-header"><div><p className="analyst-hint">ارفع PDF أو DOCX أو EPUB أو HTML أو JSON أو JSONL أو CSV أو Markdown أو TXT؛ يُستخرج النص ثم يُرفع كملف TXT إلى مكتبة Hugging Face العامة ويُفهرس في D1، من دون حفظ هذا الاستيراد في Neon أو KV.</p></div><div className="kb-stats"><div className="kb-stat"><strong>{entries.length}</strong> سجل</div><div className="kb-stat"><strong>{countUniqueTags(entries)}</strong> وسوم</div></div></div>
      {loading ? <div className="kb-empty"><p>جارٍ التحميل...</p></div> : entries.length === 0 ? <div className="kb-empty"><h3>لا توجد مدخلات بعد</h3><p>اكتب فكرة أو ارفع كتاباً أو محتوى صوتياً ليقوم المحلل بتجهيزه.</p></div> : <div className="kb-grid">{entries.map((entry) => <div key={entry.id} className="kb-card">
        <div className="kb-card-field"><span className="kb-card-label">التعليمة / الفكرة</span><span className="kb-card-value">{entry.instruction}</span></div>
        {entry.context && <div className="kb-card-field"><span className="kb-card-label">السياق</span><span className="kb-card-value">{entry.context}</span></div>}
        <div className="kb-card-field"><span className="kb-card-label">الاستجابة {entry.metadata?.needs_review && <em className="review-badge">تحتاج مراجعة</em>}</span><span className="kb-card-value">{entry.response || 'لم تُحدد بعد'}</span></div>
        <div className="kb-card-actions"><span className="kb-date">{entry.metadata?.source_name || new Date(entry.created_at).toLocaleDateString('ar-EG')}</span><button className="kb-delete" onClick={() => handleDelete(entry.id)}><IconTrash /></button></div>
      </div>)}</div>}
    </div>

    {showImporter && <div className="modal-overlay" onClick={() => !libraryUploadBusy && setShowImporter(false)}><div className="modal import-modal" onClick={(e) => e.stopPropagation()}><div className="modal-title-row"><h3>معاينة المحلل · {sourceName}</h3><button className="icon-btn" onClick={() => !libraryUploadBusy && setShowImporter(false)}><IconClose /></button></div><p className="analyst-hint">تم التعرف على {preview.length} سجل. راجعها قبل الرفع؛ سيُرفع النص المستخرج بصيغة TXT إلى Hugging Face العام بعد تأكيدك، ولن تُحفظ هذه البيانات في Neon أو KV.</p><div className="analysis-actions"><button className="header-btn" onClick={handleIntellectualAnalysis} disabled={analysisBusy || libraryUploadBusy}>{analysisBusy ? 'جارٍ استخراج العقد...' : 'تحليل فكري عميق'}</button></div>{analysisJson && <details className="analysis-json"><summary>عرض JSON الصارم الناتج</summary><pre>{analysisJson}</pre></details>}<div className="import-preview">{preview.slice(0, 20).map((item, index) => <div className="import-row" key={index}><span className="import-index">{index + 1}</span><div><strong>{item.instruction || 'بدون تعليمة'}</strong><small>{item.response || 'بدون استجابة — مراجعة مطلوبة'}</small></div><span className={item.response ? 'ready-dot' : 'review-dot'} /></div>)}</div><div className="modal-actions"><button className="btn-secondary" onClick={() => !libraryUploadBusy && setShowImporter(false)} disabled={libraryUploadBusy}>إلغاء</button><button className="btn-primary" onClick={handleImport} disabled={libraryUploadBusy}><IconUpload size={16} /> {libraryUploadBusy ? 'جارٍ تسجيل الدخول والرفع...' : 'رفع النص إلى Hugging Face'}</button></div></div></div>}
    {showModal && <div className="modal-overlay" onClick={() => setShowModal(false)}><div className="modal" onClick={(e) => e.stopPropagation()}><h3>إدخال فكرة أو عينة تدريب</h3><Field label="الفكرة / Instruction *" value={form.instruction} onChange={(value) => setForm({ ...form, instruction: value })} placeholder="ما الذي تريد تعليمه للنموذج؟" /><Field label="السياق / Context" value={form.context} onChange={(value) => setForm({ ...form, context: value })} placeholder="سياق إضافي اختياري" /><Field label="الإجابة / Response" value={form.response} onChange={(value) => setForm({ ...form, response: value })} placeholder="اتركها فارغة إن كانت فكرة تحتاج مراجعة" /><div className="modal-field"><label>وسوم</label><input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="book, arabic, audio" /></div><div className="modal-actions"><button className="btn-secondary" onClick={() => setShowModal(false)}>إلغاء</button><button className="btn-primary" onClick={handleAdd}><IconSave size={16} /> حفظ</button></div></div></div>}
  </>
}

function Field({ label, value, onChange, placeholder }) { return <div className="modal-field"><label>{label}</label><textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></div> }
function countUniqueTags(entries) { return new Set(entries.flatMap((entry) => entry.tags || [])).size }
