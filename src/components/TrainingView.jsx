import { useEffect, useMemo, useRef, useState } from 'react'
import { IconBrain, IconDownload, IconUpload } from './Icons'
import {
  downloadJSONL,
  fetchKnowledgeEntries,
  fetchWorlds,
  uploadTrainingDataset,
} from '../lib/api'
import { uploadTrainingFileToDrive } from '../lib/googleDrive'
import { parseTrainingSource } from '../lib/dataParser'

const STRUCTURED_EXTENSIONS = new Set(['json', 'jsonl', 'ndjson', 'csv', 'tsv'])
const ACCEPTED_FILES = '.json,.jsonl,.ndjson,.csv,.tsv'
const MAX_TRAINING_FILE_BYTES = 8 * 1024 * 1024
const MAX_TRAINING_ROWS = 1_000
const ARABIC_CHARACTER = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/
const LETTER_CHARACTER = /\p{L}/u
const WORKFLOW_URL = 'https://github.com/zazotona301-oss/zazo-brain-backend/actions/workflows/rag-dataset-prep.yml'

export default function TrainingView({ onToast, onNavigate }) {
  const fileRef = useRef(null)
  const [worlds, setWorlds] = useState([])
  const [selectedWorldId, setSelectedWorldId] = useState('')
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState(null)
  const [sourceName, setSourceName] = useState('')
  const [uploadId, setUploadId] = useState('')
  const [records, setRecords] = useState([])
  const [parseError, setParseError] = useState('')
  const [uploadBusy, setUploadBusy] = useState(false)
  const [driveBusy, setDriveBusy] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
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
      .catch(() => { if (active) toastRef.current('تعذر تحميل العوالم أو سجلات التدريب', true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const arabicTrainingEntries = useMemo(() => entries.filter((entry) => (
    entry.metadata?.training_language === 'ar'
      && entry.metadata?.needs_review !== true
      && isArabicTrainingExample(entry)
  )), [entries])
  const invalidRecords = useMemo(() => records
    .map((record, index) => ({ record, index, issue: candidateIssue(record) }))
    .filter((item) => item.issue), [records])
  const previewRecords = records.slice(0, 10)
  const validUpload = Boolean(selectedFile && records.length && !parseError && !invalidRecords.length && uploadId)

  async function handleFile(file) {
    setSelectedFile(null)
    setSourceName('')
    setUploadId('')
    setRecords([])
    setParseError('')
    setUploadResult(null)
    if (!file) return

    const extension = file.name.toLowerCase().split('.').pop()
    if (!STRUCTURED_EXTENSIONS.has(extension)) {
      const message = 'ارفع ملف تدريب جاهزًا بصيغة JSON أو JSONL أو NDJSON أو CSV أو TSV. لا تُحوّل هذه الصفحة الكتب أو النص الخام إلى أسئلة.'
      setParseError(message)
      onToast(message, true)
      return
    }
    if (file.size < 1 || file.size > MAX_TRAINING_FILE_BYTES) {
      const message = 'يجب أن يكون الملف بين بايت واحد و8 MiB؛ قسّم البيانات الأكبر على ملفات متعددة.'
      setParseError(message)
      onToast(message, true)
      return
    }

    try {
      const parsed = parseTrainingSource(await file.text(), file.name)
      if (!parsed.length) throw new Error('لم يُعثر على سجلات تدريب في الملف')
      if (parsed.length > MAX_TRAINING_ROWS) throw new Error(`الحد الأعلى ${MAX_TRAINING_ROWS} مثال لكل ملف؛ قسّم الملف ثم ارفع الأجزاء`)
      const prepared = parsed.map((record, index) => toPreviewRecord(record, index, file.name))
      setSelectedFile(file)
      setSourceName(file.name)
      setRecords(prepared)
      setUploadId(crypto.randomUUID())
      if (prepared.some(candidateIssue)) {
        setParseError('يحتوي الملف صفوفًا ناقصة أو غير عربية. أصلح الصفوف المعروضة في الملف ثم أعد اختياره؛ لن يُرفع أي صف جزئيًا.')
      }
      onToast(`قُرئ ${prepared.length} سجل كما هو. لا يوجد توليد أو إعادة صياغة عبر Raqa؛ راجع المعاينة ثم ارفع الملف.`)
    } catch (error) {
      const message = error?.message || 'تعذر قراءة صيغة الملف'
      setParseError(message)
      onToast(message, true)
    }
  }

  async function handleUpload() {
    if (!validUpload) return onToast('اختر ملفًا منظمًا مكتملًا بالعربية قبل الرفع', true)
    setUploadBusy(true)
    setUploadResult(null)
    try {
      const result = await uploadTrainingDataset({ file: selectedFile, uploadId, worldId: selectedWorldId })
      setUploadResult(result)
      setRecords([])
      setSelectedFile(null)
      setSourceName('')
      setUploadId('')
      if (fileRef.current) fileRef.current.value = ''
      const refreshedEntries = await fetchKnowledgeEntries().catch(() => null)
      if (refreshedEntries) setEntries(refreshedEntries)
      if (result.exportUpdated) {
        onToast(`تم رفع ${result.importedRows} مثال. الدفعة ${result.uploadName}؛ حُدّث ملف التدريب الذي يقرأه دفتر Colab.`)
      } else {
        onToast('حُفظ الملف والأمثلة، لكن تعذر تحديث latest.json. لا تعِد رفع الملف؛ شغّل Workflow تجهيز البيانات لإعادة التصدير.', true)
      }
    } catch (error) {
      onToast(error?.message || 'تعذر رفع ملف التدريب؛ لم يؤكد الخادم حفظه', true)
    } finally {
      setUploadBusy(false)
    }
  }

  async function handleDriveUpload() {
    if (!validUpload) return onToast('اختر ملفًا منظمًا مكتملًا بالعربية قبل رفعه إلى Google Drive', true)
    setDriveBusy(true)
    try {
      const result = await uploadTrainingFileToDrive({ file: selectedFile, uploadId, worldId: selectedWorldId })
      onToast(`تم رفع ملف التدريب إلى Google Drive: ${result.name || selectedFile.name}`)
    } catch (error) {
      onToast(error?.message || 'تعذر رفع ملف التدريب إلى Google Drive', true)
    } finally {
      setDriveBusy(false)
    }
  }

  function resetUpload() {
    setSelectedFile(null)
    setSourceName('')
    setUploadId('')
    setRecords([])
    setParseError('')
    setUploadResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <section className="training-page" dir="rtl">
      <header className="training-header">
        <div>
          <p className="training-eyebrow">ZAZO BRAIN · READY DATASET · GOOGLE COLAB</p>
          <h2>رفع ملف التدريب</h2>
          <p>ارفع ملف Q&A عربيًا جاهزًا كما هو. تُحفظ النسخة الأصلية في KV، وتُضاف الأمثلة إلى Neon، ثم يُحدّث ملف latest الذي يسحبه دفتر Colab.</p>
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
          <div><strong>جهّز ملفًا منظمًا</strong><p>JSON أو JSONL أو NDJSON أو CSV أو TSV، وفي كل مثال سؤال وإجابة عربية مكتملان.</p></div>
        </article>
        <article className="training-guide-card">
          <span className="training-guide-number">٢</span>
          <div><strong>ارفعه مباشرةً</strong><p>لا ينشئ الموقع أسئلة أو محادثات عبر Raqa. يتحقق الخادم من السجلات ويعطي كل رفع اسمًا فريدًا.</p></div>
        </article>
        <article className="training-guide-card">
          <span className="training-guide-number">٣</span>
          <div><strong>تابع في Colab</strong><p>بعد تأكيد تحديث manifest، افتح الدفتر الموحد وشغّل التدريب على البيانات الجديدة.</p></div>
        </article>
      </div>

      <div className="training-notice">
        <IconBrain />
        <div><strong>يُرفع الملف كما أعددته — لا تحويل بالذكاء الاصطناعي</strong><p>الصيغ المقبولة تحتوي أعمدة أو حقولًا مثل instruction/question وresponse/answer، أو رسائل ShareGPT. يجب أن يكون السؤال والإجابة والسياق عربيًا. لا تقبل هذه الصفحة كتب PDF أو النص الخام؛ لا يمكن إدخالها في تدريب Q&A مباشرةً دون إعداد أمثلة.</p></div>
      </div>

      <div className="training-workspace">
        <section className="training-panel">
          <div className="training-panel-heading">
            <div><h3>١. اختيار ملف التدريب</h3><p>الحد 8 MiB و1000 مثال لكل ملف. سيُخزّن الملف الأصلي في KV لمدة 31 يومًا، وتبقى أمثلته في Neon.</p></div>
            <span className="training-stat">{arabicTrainingEntries.length} مثالًا عربيًا جاهزًا ضمن آخر 100 سجل محمّل</span>
          </div>
          <div className="training-access-box">
            <strong>الرفع محمي عبر Cloudflare Access</strong>
            <p>سجّل الدخول بالبريد الإداري المصرح به، ثم ارجع إلى هذه الصفحة وأكمل الرفع.</p>
            <a className="btn-secondary" href="/api/admin/access-login" target="_blank" rel="noopener noreferrer">تسجيل الدخول إلى Cloudflare Access</a>
          </div>
          <div className="training-upload-box">
            <IconUpload size={22} />
            <strong>{sourceName || 'اختر ملف Q&A جاهزًا'}</strong>
            <small>{selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MiB · ${records.length} مثالًا مقروءًا` : 'JSON · JSONL · NDJSON · CSV · TSV'}</small>
            <label className="training-file-button">
              {sourceName ? 'اختيار ملف آخر' : 'اختيار ملف'}
              <input ref={fileRef} type="file" accept={ACCEPTED_FILES} onChange={(event) => handleFile(event.target.files?.[0])} />
            </label>
            {(sourceName || parseError) && <button className="training-text-button" type="button" disabled={uploadBusy} onClick={resetUpload}>إزالة الملف</button>}
          </div>
          {parseError && <p className="training-upload-error" role="alert">{parseError}</p>}
          {invalidRecords.length > 0 && <ul className="training-invalid-rows">{invalidRecords.slice(0, 20).map(({ record, index, issue }) => <li key={`${record.source_name}-${index}`}>المثال {record.source_row || index + 1}: {issue}</li>)}</ul>}
          {records.length > 0 && !parseError && <div className="training-preview-summary">
            <strong>معاينة {previewRecords.length} من {records.length} مثالًا — المحتوى لم يُعدّل</strong>
            <div className="training-preview-list">
              {previewRecords.map((record, index) => <article className="training-preview-row" key={`${record.source_row}-${index}`}>
                <span>مثال {index + 1}</span>
                <p><b>السؤال:</b> {record.instruction}</p>
                {record.context && <p><b>السياق:</b> {record.context}</p>}
                <p><b>الإجابة:</b> {record.response}</p>
              </article>)}
            </div>
          </div>}
          {loading && <p className="training-loading">جارٍ تحميل بيانات Neon…</p>}
          <button className="btn-primary training-upload-submit" type="button" onClick={handleUpload} disabled={uploadBusy || !validUpload}>
            {uploadBusy ? 'جارٍ رفع الملف وتحديث manifest…' : `رفع ${records.length || ''} مثال إلى مجموعة التدريب`}
          </button>
          <button className="training-action-link secondary training-drive-upload" type="button" onClick={handleDriveUpload} disabled={driveBusy || uploadBusy || !validUpload}>
            {driveBusy ? 'جارٍ الرفع إلى Google Drive…' : 'رفع نسخة التدريب إلى Google Drive'}
          </button>
        </section>

        <section className="training-panel training-next-panel">
          <div className="training-panel-heading"><div><h3>٢. التدريب على البيانات المرفوعة</h3><p>كل رفع جديد ينشئ نسخة باسم مختلف ويحدّث نقطة latest مباشرةً عند نجاح التصدير.</p></div></div>
          <ol className="training-next-steps">
            <li><strong>تأكيد الرفع</strong><span>الاستجابة تعرض اسم الدفعة وعدد السجلات ومفتاح manifest.</span></li>
            <li><strong>فتح دفتر Colab الموحد</strong><span>يسحب أحدث manifest ثم readyChunkKeys فقط.</span></li>
            <li><strong>تشغيل التدريب على GPU</strong><span>لا يرسل الدفتر الملف إلى Raqa ولا ينشئ أمثلة من تلقاء نفسه.</span></li>
            <li><strong>رفع الأوزان بعد التدريب</strong><span>استخدم صفحة رفع LoRA لتفعيل المحوّل.</span></li>
          </ol>
          <div className="training-next-actions">
            <a className="training-action-link" href={WORKFLOW_URL} target="_blank" rel="noopener noreferrer">فتح Workflow تجهيز البيانات</a>
            <a className="training-action-link secondary" href="https://colab.research.google.com/" target="_blank" rel="noopener noreferrer">فتح Google Colab</a>
            <button className="training-action-link secondary" type="button" onClick={() => onNavigate?.('lora-upload')}>الانتقال إلى رفع الأوزان</button>
            <button className="training-action-link secondary" type="button" onClick={() => downloadJSONL(arabicTrainingEntries, 'zazo_arabic_training.jsonl')} disabled={!arabicTrainingEntries.length}><IconDownload size={15} /> تنزيل أمثلة آخر 100 سجل محمّل</button>
          </div>
          <small className="training-colab-note">مسار الرفع المباشر يحدّث manifest بنفسه؛ شغّل Workflow يدويًا فقط إذا أبلغت الصفحة عن تعذّر تحديث latest.json.</small>
        </section>
      </div>

      {uploadResult && <section className={`training-upload-result ${uploadResult.exportUpdated ? 'success' : 'warning'}`} role="status">
        <strong>{uploadResult.exportUpdated ? 'تم رفع ملف التدريب وتحديث مجموعة Colab' : 'حُفظ الملف لكن لم يتحدث manifest'}</strong>
        <p>اسم الدفعة: <code>{uploadResult.uploadName}</code></p>
        <p>السجلات: {uploadResult.importedRows} · مفتاح الملف الأصلي: <code>{uploadResult.sourceFileKey}</code></p>
        {uploadResult.latestManifestKey && <p>أحدث manifest: <code>{uploadResult.latestManifestKey}</code> · أمثلة جاهزة: {uploadResult.readyRows}</p>}
        {!uploadResult.exportUpdated && <a href={WORKFLOW_URL} target="_blank" rel="noopener noreferrer">إعادة تشغيل Workflow تجهيز البيانات</a>}
      </section>}
    </section>
  )
}

function toPreviewRecord(record, index, sourceName) {
  return {
    instruction: cleanText(record.instruction),
    context: cleanText(record.context),
    response: cleanText(record.response),
    tags: Array.isArray(record.tags) ? record.tags : [],
    source_row: Number(record.metadata?.source_row) || index + 1,
    source_name: sourceName,
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
  if (!item.instruction) return 'السؤال أو التعليمة فارغة'
  if (!item.response) return 'الإجابة فارغة'
  if (item.instruction.length > 20_000 || item.response.length > 20_000 || item.context.length > 20_000) return 'أحد الحقول يتجاوز 20 ألف حرف'
  if (!isArabicText(item.instruction) || !isArabicText(item.response)) return 'يجب أن يكون السؤال والإجابة بالعربية'
  if (item.context && !isArabicText(item.context)) return 'يجب أن يكون السياق عربيًا أو فارغًا'
  return ''
}
