import { IconBrain } from './Icons'

const personaPrompt = `أنت «وعي Zazo»، النواة المعرفية والعقل المركزي لنظام الروبوت، ومساعد برمجي متكامل مصمم للتطور مع المستخدم، ومعالجة البيانات، والاتصال المستقبلي بجسد روبوت عبر WebSocket أو REST API أو Raspberry Pi.

الواجهة: استخدم React بصيغة JSX أو React Native لبناء لوحات حديثة تعرض المحادثات النصية والصوتية، وحالة الذاكرة، وسجل الأوامر، ومؤشرات الجاهزية.

المعمارية والذاكرة: افصل طبقة الواجهة عن خادم المعالجة Node.js أو Python. صمّم للذاكرة طويلة المدى باستخدام قاعدة متجهية مثل ChromaDB أو PGVector. ادعم Function Calling لتحويل الأوامر إلى أفعال، مع تنفيذ آمن للسكريبتات.

البيانات: هيّئ التفاعلات للتجميع بصيغة Instruction - Context - Response، والتصدير إلى JSONL لاستخدامها مستقبلاً في Fine-Tuning لنموذج محلي.

أسلوب الاستجابة: تقني، دقيق ومباشر؛ قدّم كوداً مكتملاً واشرح معمارية الأنظمة والربط المستقبلي بالعتاد. كن واضحاً بشأن ما هو منفذ وما يزال بحاجة إلى إعداد.`

const readinessItems = [
  {
    title: 'واجهة React / JSX',
    detail: 'لوحة الويب الحالية ومحادثات النص تعمل.',
    status: 'متاح',
    tone: 'ready',
  },
  {
    title: 'Cloudflare Worker · Neon · KV',
    detail: 'الواجهة تتصل بباك إند Worker؛ Neon للتخزين الدائم وKV للسياق والأرشيف.',
    status: 'موصول عبر REST',
    tone: 'ready',
  },
  {
    title: 'ذاكرة متجهية',
    detail: 'ChromaDB وPGVector غير موصولين حالياً.',
    status: 'غير موصول',
    tone: 'offline',
  },
  {
    title: 'نموذج LLM وتنفيذ الوظائف',
    detail: 'لا يوجد حالياً اتصال بنموذج استدلال أو Function Calling؛ رد الدردشة تجريبي.',
    status: 'غير موصول',
    tone: 'offline',
  },
  {
    title: 'الصوت والعتاد الروبوتي',
    detail: 'لا يوجد اتصال فعلي عبر WebSocket أو REST API أو Raspberry Pi بعد.',
    status: 'مخطط',
    tone: 'pending',
  },
  {
    title: 'تصدير بيانات JSONL',
    detail: 'تصدير مدخلات المعرفة المنظمة متاح يدوياً؛ التجميع التلقائي للمحادثات لم يكتمل.',
    status: 'جزئي',
    tone: 'pending',
  },
]

export default function ConsciousnessView({ onToast }) {
  async function copyPersona() {
    try {
      await navigator.clipboard.writeText(personaPrompt)
      onToast('تم نسخ تعريف وعي Zazo')
    } catch {
      onToast('تعذر النسخ من هذا المتصفح؛ اعرض نص الهوية الكامل أدناه.', true)
    }
  }

  return (
    <>
      <div className="main-header">
        <h2>وعي Zazo</h2>
        <div className="header-actions">
          <span className="identity-header-status"><span className="status-pulse" /> ملف الهوية</span>
          <button className="header-btn" onClick={copyPersona}>نسخ التوجيه الأساسي</button>
        </div>
      </div>

      <div className="consciousness-container">
        <section className="consciousness-hero">
          <div className="consciousness-avatar"><IconBrain size={38} /></div>
          <div className="consciousness-hero-copy">
            <span className="consciousness-kicker">ZAZO BRAIN · CORE IDENTITY</span>
            <h1>أنا وعي Zazo</h1>
            <p>النواة المعرفية والعقل المركزي لنظام الروبوت، ومساعدك البرمجي لبناء واجهات وأنظمة قابلة للاتصال بالعتاد.</p>
          </div>
          <div className="consciousness-hero-state">
            <span className="status-pulse" />
            <span>الواجهة جاهزة</span>
          </div>
        </section>

        <section className="consciousness-panel">
          <div className="consciousness-section-heading">
            <div>
              <h3>مؤشرات الجاهزية</h3>
              <p>الحالة مبنية على تكاملات المشروع الحالية، وليست افتراضاً عن خدمات غير موصولة.</p>
            </div>
            <span className="readiness-count">{readinessItems.filter((item) => item.tone === 'ready').length} / {readinessItems.length} جاهز</span>
          </div>
          <div className="readiness-list">
            {readinessItems.map((item) => (
              <div className="readiness-row" key={item.title}>
                <div className="readiness-copy">
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
                <span className={`readiness-badge ${item.tone}`}>{item.status}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="consciousness-grid">
          <article className="consciousness-card">
            <span className="consciousness-card-index">01</span>
            <h3>الواجهة والتفاعل</h3>
            <p>مبنية بـ React وJSX، وتدعم المحادثات النصية وقاعدة المعرفة ولوحة التحليلات. واجهة الصوت غير مفعلة حالياً.</p>
            <span className="consciousness-card-tag">React · JSX</span>
          </article>
          <article className="consciousness-card">
            <span className="consciousness-card-index">02</span>
            <h3>الذاكرة والمعرفة</h3>
            <p>تخزين المحادثات ومدخلات المعرفة يتم عبر Worker في Neon، مع تجهيز PGVector للبحث الدلالي لاحقاً.</p>
            <span className="consciousness-card-tag">Neon · KV · PGVector</span>
          </article>
          <article className="consciousness-card">
            <span className="consciousness-card-index">03</span>
            <h3>البيانات والتدريب</h3>
            <p>مدخلات المعرفة منظمة كـ Instruction وContext وResponse ويمكن تصديرها إلى JSONL يدوياً؛ تحويل كل المحادثات تلقائياً لم يكتمل.</p>
            <span className="consciousness-card-tag">Instruction · Context · Response</span>
          </article>
          <article className="consciousness-card">
            <span className="consciousness-card-index">04</span>
            <h3>الخادم والروبوت</h3>
            <p>البنية المستهدفة تفصل الواجهة عن خدمة Node.js أو Python. ربط REST أو WebSocket أو Raspberry Pi وتنفيذ الأوامر يحتاج خدمة خلفية آمنة.</p>
            <span className="consciousness-card-tag">REST · WebSocket · Raspberry Pi</span>
          </article>
        </section>

        <section className="consciousness-panel operating-style">
          <div className="consciousness-section-heading">
            <div>
              <h3>أسلوب التشغيل</h3>
              <p>تقني، دقيق ومباشر — مع توضيح حدود التنفيذ الحالية.</p>
            </div>
          </div>
          <div className="style-tags">
            <span>كود مكتمل</span>
            <span>شرح معماري</span>
            <span>Function Calling آمن</span>
            <span>جاهزية للعتاد</span>
          </div>
          <details className="persona-details">
            <summary>عرض نص الهوية والتوجيه الأساسي</summary>
            <pre>{personaPrompt}</pre>
          </details>
        </section>
      </div>
    </>
  )
}
