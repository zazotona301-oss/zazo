import { useState } from 'react'
import { uploadLoraAdapter } from '../lib/api'

export default function LoraUploadView({ onToast }) {
  const [adminToken, setAdminToken] = useState('')
  const [configFile, setConfigFile] = useState(null)
  const [weightsFile, setWeightsFile] = useState(null)
  const [fineTuneName, setFineTuneName] = useState('zazo-brain-v1')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    if (!adminToken.trim()) return onToast('أدخل رمز الرفع الإداري', true)
    if (!configFile || !weightsFile) return onToast('اختر adapter_config.json وadapter_model.safetensors', true)
    if (configFile.name !== 'adapter_config.json' || weightsFile.name !== 'adapter_model.safetensors') {
      return onToast('يجب أن يكون اسما الملفين adapter_config.json وadapter_model.safetensors بالضبط', true)
    }
    setBusy(true)
    setResult(null)
    try {
      const uploaded = await uploadLoraAdapter({ adminToken, configFile, weightsFile, fineTuneName })
      setResult(uploaded)
      onToast('تم رفع محول Zazo إلى Cloudflare Workers AI')
    } catch (error) {
      onToast(error?.message || 'تعذر رفع المحول إلى Cloudflare', true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="lora-upload-page" dir="rtl">
      <header className="lora-upload-header">
        <div>
          <p className="lora-eyebrow">ZAZO BRAIN · WORKERS AI</p>
          <h2>رفع محول التدريب</h2>
          <p>ارفع ملفات LoRA الناتجة عن تدريب Gemma المتوافق، وسيُنشئ الخادم fine-tune ويرفع الملفات إلى Cloudflare.</p>
        </div>
      </header>

      <form className="lora-upload-card" onSubmit={handleSubmit}>
        <label className="lora-field">
          <span>رمز الرفع الإداري</span>
          <input
            type="password"
            autoComplete="off"
            value={adminToken}
            onChange={(event) => setAdminToken(event.target.value)}
            placeholder="أدخل الرمز الذي ضبطته كسرّ في Worker"
            required
          />
          <small>يُرسل إلى Worker للتحقق ولا يُحفظ في المتصفح أو داخل المستودع.</small>
        </label>

        <label className="lora-field">
          <span>اسم Fine-tune</span>
          <input
            type="text"
            value={fineTuneName}
            onChange={(event) => setFineTuneName(event.target.value)}
            pattern="[A-Za-z0-9_-]{3,48}"
            title="من 3 إلى 48 حرفًا أو رقمًا أو شرطة"
            required
          />
        </label>

        <div className="lora-file-grid">
          <label className="lora-file-field">
            <span>إعداد المحول</span>
            <input type="file" accept=".json,application/json" onChange={(event) => setConfigFile(event.target.files?.[0] || null)} />
            <small>{configFile?.name || 'اختر adapter_config.json'}</small>
          </label>
          <label className="lora-file-field">
            <span>أوزان المحول</span>
            <input type="file" accept=".safetensors" onChange={(event) => setWeightsFile(event.target.files?.[0] || null)} />
            <small>{weightsFile ? `${weightsFile.name} · ${(weightsFile.size / (1024 * 1024)).toFixed(1)} MB` : 'اختر adapter_model.safetensors'}</small>
          </label>
        </div>

        <div className="lora-notice">
          ارفع محولًا مدرّبًا على قاعدة Gemma غير مكمّمة ومتوافقًا مع Cloudflare. حد Cloudflare لملف الأوزان أقل من 300MB. الرفع ينشئ موردًا جديدًا ولا يستبدل محولًا سابقًا.
        </div>

        <button className="btn-primary lora-submit" type="submit" disabled={busy}>
          {busy ? 'جارٍ الرفع إلى Cloudflare…' : 'إنشاء Fine-tune ورفع الملفات'}
        </button>
      </form>

      {result && (
        <div className="lora-result" role="status">
          <strong>اكتمل الرفع</strong>
          <p>معرّف Fine-tune: <code>{result.fineTuneId}</code></p>
          <p>النموذج: <code>{result.model}</code></p>
          <p>أضف المعرّف إلى سرّ <code>CLOUDFLARE_LORA_ID</code> في إعدادات Worker لتفعيل الاستدلال بالمحول.</p>
        </div>
      )}
    </section>
  )
}
