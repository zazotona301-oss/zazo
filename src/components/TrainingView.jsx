import { useEffect, useMemo, useRef, useState } from 'react'
import { IconBrain, IconClose, IconDownload, IconSave, IconUpload } from './Icons'
import {
  addKnowledgeEntry,
  analyzeIntellectualText,
  downloadJSONL,
  fetchKnowledgeEntries,
  fetchWorlds,
} from '../lib/api'
import { extractFileText } from '../lib/fileExtractor'
import { parseTrainingSource } from '../lib/dataParser'

const STRUCTURED_EXTENSIONS = new Set(['json', 'jsonl', 'ndjson', 'csv', 'tsv'])
const ACCEPTED_FILES = '.pdf,.docx,.epub,.txt,.md,.markdown,.html,.htm,.json,.jsonl,.ndjson,.csv,.tsv'
const MAX_ANALYSIS_CHARS = 80_000
const ARABIC_CHARACTER = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/
const LETTER_CHARACTER = /\p{L}/u
const WORKFLOW_URL = 'https://github.com/zazotona301-oss/zazo-brain-backend/actions/workflows/rag-dataset-prep.yml'

export default function TrainingView({ onToast, onNavigate }) {
  const fileRef = useRef(null)
  const [worlds, setWorlds] = useState([])
  const [selectedWorldId, setSelectedWorldId] = useState('')
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [sourceName, setSourceName] = useState('')
  const [rawText, setRawText] = useState('')
  const [sourceMode, setSourceMode] = useState('')
  const [candidates, setCandidates] = useState([])
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveProgress, setSaveProgress] = useState('')
  const toastRef = useRef(onToast)
  toastRef.current = onToast

  useEffect(() => {
    let active = true
    Promise.all([fetchWorlds(), fetchKnowledgeEntries()])
      .then(([loadedWorlds, loadedEntries]) => {
        if (!active) return
        setWorlds(loadedWorlds)
        setEntries(loadedEntries)
        const preferredWorld = loadedWorlds.find((world) => world.slug === 'World_Religion_Philosophy') || loadedWorlds[0]
        if (preferredWorld) setSelectedWorldId(preferredWorld.id)
      })
      .catch(() => {
        if (active) toastRef.current('تعذر تحميل العوالم أو سجلات التدريب', true)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const selectedWorld = worlds.find((world) => world.id === selectedWorldId)
  const arabicTrainingEntries = useMemo(() => entries.filter((entry) => (
    entry.metadata?.training_language === 'ar'
      && entry.metadata?.needs_review !== true
      && isArabicTrainingExample(entry)
  )), [entries])
  const selectedCount = candidates.filter((item) => item.selected && !candidateIssue(item)).length

  async function handleFile(file) {
    if (!file) return
    try {
      const text = await extractFileText(file)
      if (!text.trim()) throw new Error('لم يُعثر على نص قابل للاستخراج من الملف')
      setSourceMode('')
      setSourceName(file.name)
      setRawText(text)
      setCandidates([])
      const extension = file.name.toLowerCase().split('.').pop()
      if (STRUCTURED_EXTENSIONS.has(extension)) {
        const records = parseTrainingSource(text, file.name)
        setCandidates(records.map((record, index) => toCandidate(record, index, file.name)))
        setSourceMode('structured')
        onToast(`قُرئ ${records.length} سجل من الملف. راجع الصياغة العربية وحدد الأمثلة التي تريد اعتمادها.`)
      } else {
        setSourceMode('document')
        onToast(`تم استخراج ${text.length.toLocaleString('ar-EG')} حرفًا من ${file.name}. حوّله الآن إلى أمثلة عربية مقترحة.`)
      }
    } catch (error) {
      setSourceMode('')
      onToast(error?.message || 'تعذرت قراءة الملف أو الصيغة غير مدعومة', true)
    }
  }

  async function handleAnalyzeSource() {
    if (!rawText.trim()) return onToast('ارفع مادة أولًا لاستخراج النص', true)
    const chunks = splitSourceForAnalysis(rawText, MAX_ANALYSIS_CHARS)
    if (!chunks.length) return onToast('لم يتبق نص صالح للتحليل', true)
    setAnalysisBusy(true)
    setCandidates([])
    const generated = []
    try {
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        setAnalysisProgress(`يحلل Raqa الجزء ${chunkIndex + 1} من ${chunks.length}…`)
        const result = await analyzeIntellectualText(chunks[chunkIndex], {
          title: `${sourceName || 'مادة تدريب'} — الجزء ${chunkIndex + 1}`,
          category: selectedWorld?.name || 'معرفة عامة',
        })
        const nodes = Array.isArray(result.extracted_nodes) ? result.extracted_nodes : []
        nodes.forEach((node, nodeIndex) => {
          const title = cleanText(node?.concept_title)
          const summary = cleanText(node?.core_summary)
          const takeaway = cleanText(node?.key_takeaway)
          const response = [summary, takeaway].filter(Boolean).join('\n\n')
          if (!response) return
          generated.push({
            id: `raqa-${chunkIndex}-${nodeIndex}-${Date.now()}`,
            instruction: title
              ? `اشرح مفهوم «${title}» كما تعرضه المادة.`
              : 'ما الفكرة الأساسية التي تعرضها هذه المادة؟',
            context: '',
            response,
            tags: ['تدريب-عربي', ...(Array.isArray(node.tags) ? node.tags.filter((tag) => typeof tag === 'string') : [])],
            selected: false,
            source_name: sourceName,
          })
        })
      }
      setCandidates(generated)
      setSourceMode('generated')
      if (generated.length) {
        onToast(`أنشأ Raqa ${generated.length} اقتراحًا. راجع كل سؤال وإجابة واعتمد ما تثق بدقته فقط.`)
      } else {
        onToast('لم ينتج المحلل أمثلة قابلة للاعتماد من هذه المادة', true)
      }
    } catch (error) {
      onToast(error?.message || 'تعذر تحليل المادة؛ لم تُحفظ أمثلة جزئية', true)
    } finally {
      setAnalysisBusy(false)
      setAnalysisProgress('')
    }
  }

  function updateCandidate(id, patch) {
    setCandidates((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  function selectAllValid() {
    setCandidates((current) => current.map((item) => ({ ...item, selected: !candidateIssue(item) })))
  }

  async function handleSaveApproved() {
    const approved = candidates.filter((item) => item.selected && !candidateIssue(item))
    if (!approved.length) return onToast('حدد مثالًا واحدًا على الأقل بعد التأكد من السؤال والإجابة بالعربية', true)
    setSaveBusy(true)
    const savedRows = []
    try {
      for (let start = 0; start < approved.length; start += 10) {
        const batch = approved.slice(start, start + 10)
        setSaveProgress(`حفظ ${Math.min(start + batch.length, approved.length)} من ${approved.length}…`)
        const payloads = batch.map((item) => ({
          instruction: item.instruction.trim(),
          context: item.context.trim(),
          response: item.response.trim(),
          worldId: selectedWorldId || undefined,
          tags: [...new Set(['تدريب-عربي', ...(item.tags || [])])],
          source_name: item.source_name || sourceName || 'manual-arabic-training',
          metadata: {
            ingestion: 'arabic_training_portal',
            training_language: 'ar',
            needs_review: false,
            arabic_reviewed: true,
            approved_at: new Date().toISOString(),
          },
        }))
        const settled = await Promise.allSettled(payloads.map((payload) => addKnowledgeEntry(payload)))
        const succeeded = settled.flatMap((result, index) => result.status === 'fulfilled'
          ? [{ memory: result.value, candidateId: batch[index].id }]
          : [])
        const failed = settled.filter((result) => result.status === 'rejected')
        const savedCandidateIds = new Set(succeeded.map((item) => item.candidateId))
        const result = succeeded.map((item) => item.memory)
        savedRows.push(...result)
        if (result.length) {
          setCandidates((current) => current.filter((item) => !savedCandidateIds.has(item.id)))
          setEntries((current) => [...result, ...current])
        }
        if (failed.length) {
          const reason = failed[0].reason?.message || 'فشل اتصال ببعض السجلات'
          onToast(`تم حفظ ${savedRows.length} مثالًا؛ تعذر حفظ ${failed.length} في هذه الدفعة، وقد بقيت للمراجعة وإعادة المحاولة. ${reason}`, true)
          return
        }
      }
      const pending = savedRows.filter((item) => item.offline || item.kvArchived === false).length
      onToast(pending
        ? `أُضيف ${savedRows.length} مثالًا؛ ${pending} بانتظار المزامنة/تعذر أرشفته في KV`
        : `تم اعتماد وحفظ ${savedRows.length} مثال عربي في Neon وKV`)
    } catch (error) {
      onToast(error?.message || `حُفظ ${savedRows.length} مثالًا قبل تعطل بقية الدفعة`, true)
    } finally {
      setSaveBusy(false)
      setSaveProgress('')
    }
  }

  function resetSource() {
    setSourceName('')
    setRawText('')
    setSourceMode('')
    setCandidates([])
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <section className="training-page" dir="rtl">
      <header className="training-header">
        <div>
          <p className="training-eyebrow">ZAZO BRAIN · ARABIC DATASET · GOOGLE COLAB GPU</p>
          <h2>تجهيز التدريب العربي</h2>
          <p>ارفع مادة علمية، استخرج منها أمثلة عربية مقترحة، راجعها واعتمدها. تُحفظ الأمثلة المعتمدة في Neon وتُؤرشف في KV لتجهيزها لدفتر Colab.</p>
        </div>
        <label className="training-world-select">
          <span>مجال المعرفة</span>
          <select value={selectedWorldId} onChange={(event) => setSelectedWorldId(event.target.value)}>
            <option value="">العالم الافتراضي</option>
            {worlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}
          </select>
        </label>
      </header>

      <div className="training-guide-grid">
        <article className="training-guide-card">
          <span className="training-guide-number">١</span>
          <div><strong>ارفع المادة</strong><p>كتاب أو ملف مصدر. PDF وDOCX وEPUB وTXT وMarkdown، أو ملف منظم JSON/JSONL/CSV/TSV.</p></div>
        </article>
        <article className="training-guide-card">
          <span className="training-guide-number">٢</span>
          <div><strong>راجع أمثلة Q&A العربية</strong><p>المادة الكاملة تصلح للمعرفة وRAG؛ أما الأوزان فتحتاج سؤالًا وإجابةً عربيين موثوقين لكل مثال.</p></div>
        </article>
        <article className="training-guide-card">
          <span className="training-guide-number">٣</span>
          <div><strong>درّب من Colab</strong><p>بعد تجهيز البيانات، شغّل دفتر Colab الحالي على GPU ثم ارفع ملفي LoRA من صفحة رفع الأوزان.</p></div>
        </article>
      </div>

      <div className="training-notice">
        <IconBrain />
        <div><strong>لا يُدرّب الملف الخام مباشرةً</strong><p>يحلل Raqa المادة لاستخراج اقتراحات، لكنه لا يرد على الشات. الملف الأصلي لا يُخزَّن من هذه الصفحة؛ الذي يُحفظ في Neon/KV هو أمثلة السؤال والجواب التي تعتمدها. إذا أردت استخدام الكتاب كاملًا في RAG فارفعه أيضًا من «قاعدة المعرفة». لن يبدأ GPU أو إنشاء الأوزان من هنا؛ التدريب الفعلي يبقى في Google Colab.</p></div>
      </div>

      <div className="training-workspace">
        <section className="training-panel">
          <div className="training-panel-heading"><div><h3>١. رفع مادة التدريب</h3><p>الملف يُقرأ في المتصفح؛ عند طلب التحليل يُرسل النص المستخرج إلى مسار Raqa الحالي.</p></div><span className="training-stat">{arabicTrainingEntries.length} مثالًا عربيًا جاهزًا ضمن آخر 100 سجل محمّل</span></div>
          <div className="training-upload-box">
            <IconUpload size={22} />
            <strong>{sourceName || 'اختر كتابًا أو ملف بيانات'}</strong>
            <small>{rawText ? `${rawText.length.toLocaleString('ar-EG')} حرف مستخرج` : 'اختر ملف مصدر أو ملف JSONL بأسئلة وأجوبة'}</small>
            <label className="training-file-button">
              {sourceName ? 'اختيار ملف آخر' : 'اختيار ملف'}
              <input ref={fileRef} type="file" accept={ACCEPTED_FILES} onChange={(event) => handleFile(event.target.files?.[0])} />
            </label>
            {sourceName && <button className="training-text-button" type="button" disabled={analysisBusy || saveBusy} onClick={resetSource}><IconClose size={14} /> إزالة الملف</button>}
          </div>

          {sourceMode === 'document' && <div className="training-source-actions">
            <p>تم استخراج النص. اضغط التحليل لإنشاء أسئلة وإجابات عربية مقترحة على دفعات؛ ستبقى للمراجعة ولن تدخل التدريب قبل اعتمادك.</p>
            <button className="btn-primary" type="button" onClick={handleAnalyzeSource} disabled={analysisBusy}>
              {analysisBusy ? analysisProgress || 'جارٍ التحليل…' : 'تحليل المادة وإنشاء أمثلة عربية'}
            </button>
          </div>}
          {sourceMode === 'structured' && <div className="training-source-actions"><p>حُمّلت سجلات منظمة؛ راجع اكتمال السؤال والإجابة والعربية قبل اعتماد أي سجل.</p></div>}
          {loading && <p className="training-loading">جارٍ تحميل بيانات Neon…</p>}
        </section>

        <section className="training-panel training-next-panel">
          <div className="training-panel-heading"><div><h3>٢. تجهيز البيانات وتدريب الأوزان</h3><p>التصدير اليومي يجهز أمثلتك المعتمدة في KV. زر GitHub يفتح تشغيلًا يدويًا فوريًا.</p></div></div>
          <ol className="training-next-steps">
            <li><strong>اعتمد الأمثلة العربية</strong><span>تُحفظ في Neon وتُنسخ إلى KV.</span></li>
            <li><strong>جهّز مجموعة Colab</strong><span>شغّل Workflow «Prepare Zazo RAG dataset» يدويًا.</span></li>
            <li><strong>درّب على GPU</strong><span>افتح دفتر Colab الحالي، اختر GPU، ثم شغّل خلاياه.</span></li>
            <li><strong>ارفع المحول</strong><span>بعد انتهاء التدريب، استخدم صفحة رفع LoRA الحالية.</span></li>
          </ol>
          <div className="training-next-actions">
            <a className="training-action-link" href={WORKFLOW_URL} target="_blank" rel="noopener noreferrer">فتح Workflow تجهيز البيانات</a>
            <a className="training-action-link secondary" href="https://colab.research.google.com/" target="_blank" rel="noopener noreferrer">فتح Google Colab</a>
            <button className="training-action-link secondary" type="button" onClick={() => onNavigate?.('lora-upload')}>الانتقال إلى رفع الأوزان</button>
            <button className="training-action-link secondary" type="button" onClick={() => downloadJSONL(arabicTrainingEntries, 'zazo_arabic_training.jsonl')} disabled={!arabicTrainingEntries.length}><IconDownload size={15} /> تنزيل أمثلة آخر 100 سجل محمّل</button>
          </div>
          <small className="training-colab-note">GitHub Action يجهّز البيانات فقط ولا يدرّب. Colab هو الذي ينشئ أوزان LoRA على GPU، ثم تُرفع الأوزان إلى Cloudflare من الصفحة الموجودة.</small>
        </section>
      </div>

      {candidates.length > 0 && <section className="training-review-panel">
        <div className="training-panel-heading training-review-heading"><div><h3>٣. مراجعة الأمثلة المقترحة</h3><p>{candidates.length} مثالًا من «{sourceName || 'الملف'}» — لا تعتمد إلا ما يطابق المصدر.</p></div><button className="training-text-button" type="button" onClick={selectAllValid}>تحديد الأمثلة الصالحة</button></div>
        <div className="training-candidate-list">
          {candidates.map((item, index) => {
            const issue = candidateIssue(item)
            return <article className={`training-candidate ${item.selected ? 'selected' : ''}`} key={item.id}>
              <div className="training-candidate-top">
                <label className="training-approve-toggle"><input type="checkbox" checked={item.selected} disabled={Boolean(issue)} onChange={(event) => updateCandidate(item.id, { selected: event.target.checked })} /><span>اعتماد المثال</span></label>
                <span className={`training-validation ${issue ? 'warning' : 'valid'}`}>{issue || 'سؤال وجواب عربيان'}</span>
                <span className="training-candidate-number">مثال {index + 1}</span>
              </div>
              <label className="training-edit-field"><span>السؤال / Instruction</span><textarea value={item.instruction} onChange={(event) => updateCandidate(item.id, { instruction: event.target.value, selected: false })} rows={2} /></label>
              <label className="training-edit-field"><span>السياق العربي (اختياري)</span><textarea value={item.context} onChange={(event) => updateCandidate(item.id, { context: event.target.value, selected: false })} rows={2} /></label>
              <label className="training-edit-field"><span>الإجابة / Response</span><textarea value={item.response} onChange={(event) => updateCandidate(item.id, { response: event.target.value, selected: false })} rows={3} /></label>
            </article>
          })}
        </div>
        <div className="training-review-footer"><span>{selectedCount} محدد للاعتماد</span><button className="btn-primary" type="button" onClick={handleSaveApproved} disabled={saveBusy || selectedCount === 0}><IconSave size={16} />{saveBusy ? saveProgress || 'جارٍ الحفظ…' : `اعتماد وحفظ ${selectedCount} مثالًا في Neon وKV`}</button></div>
      </section>}
    </section>
  )
}

function toCandidate(record, index, sourceName) {
  return {
    id: `file-${index}-${Date.now()}`,
    instruction: cleanText(record.instruction),
    context: cleanText(record.context),
    response: cleanText(record.response),
    tags: Array.isArray(record.tags) ? record.tags : [],
    selected: false,
    source_name: sourceName || 'uploaded-training-file',
  }
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isArabicText(value) {
  const characters = Array.from(String(value || ''))
  const letters = characters.filter((character) => LETTER_CHARACTER.test(character))
  if (!letters.length) return false
  const arabicLetters = letters.filter((character) => ARABIC_CHARACTER.test(character)).length
  return arabicLetters / letters.length >= 0.4
}

function isArabicTrainingExample(item) {
  return isArabicText(item.instruction)
    && isArabicText(item.response)
    && (!item.context?.trim() || isArabicText(item.context))
}

function candidateIssue(item) {
  if (!item.instruction?.trim()) return 'اكتب سؤالًا أو تعليمة'
  if (!item.response?.trim()) return 'اكتب إجابة موثوقة'
  if (item.instruction.length > 100_000 || item.response.length > 100_000 || (item.context || '').length > 100_000) return 'قلّص هذا المثال إلى أقل من 100 ألف حرف لكل حقل'
  if (!isArabicText(item.instruction) || !isArabicText(item.response)) return 'يجب أن تكون صياغة السؤال والإجابة عربية'
  if (item.context?.trim() && !isArabicText(item.context)) return 'اجعل السياق عربيًا أو اتركه فارغًا'
  return ''
}

function splitSourceForAnalysis(text, maxChars) {
  const units = []
  for (const paragraph of text.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean)) {
    if (paragraph.length <= maxChars) {
      units.push(paragraph)
      continue
    }
    let start = 0
    while (start < paragraph.length) {
      let end = Math.min(start + maxChars, paragraph.length)
      if (end < paragraph.length) {
        const boundary = paragraph.lastIndexOf(' ', end)
        if (boundary > start + Math.floor(maxChars * 0.65)) end = boundary
      }
      units.push(paragraph.slice(start, end).trim())
      start = end
    }
  }

  const chunks = []
  let current = ''
  for (const unit of units) {
    if (current && current.length + unit.length + 2 > maxChars) {
      chunks.push(current)
      current = ''
    }
    current = current ? `${current}\n\n${unit}` : unit
  }
  if (current) chunks.push(current)
  return chunks
}
