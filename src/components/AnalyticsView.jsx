import { useState, useEffect, useMemo } from 'react'
import { IconDownload } from './Icons'
import {
  fetchConversations,
  fetchAllMessages,
  fetchKnowledgeEntries,
} from '../lib/api'

export default function AnalyticsView({ onToast }) {
  const [conversations, setConversations] = useState([])
  const [messages, setMessages] = useState([])
  const [knowledge, setKnowledge] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [convos, msgs, kb] = await Promise.all([
        fetchConversations(),
        fetchAllMessages(),
        fetchKnowledgeEntries(),
      ])
      setConversations(convos)
      setMessages(msgs)
      setKnowledge(kb)
    } catch {
      onToast('فشل تحميل البيانات للتحليل', true)
    } finally {
      setLoading(false)
    }
  }

  const stats = useMemo(() => computeStats(conversations, messages, knowledge), [conversations, messages, knowledge])

  function handleExportReport() {
    const report = {
      generated_at: new Date().toISOString(),
      summary: stats.summary,
      intent_distribution: stats.intentDistribution,
      top_keywords: stats.topKeywords,
      tag_distribution: stats.tagDistribution,
      timeline: stats.timeline,
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'zazo_analytics_report.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    onToast('تم تصدير تقرير التحليل')
  }

  if (loading) {
    return (
      <>
        <div className="main-header"><h2>محرك تحليل البيانات</h2></div>
        <div className="analytics-container"><div className="kb-empty"><p>جارٍ تحليل البيانات...</p></div></div>
      </>
    )
  }

  return (
    <>
      <div className="main-header">
        <h2>محرك تحليل البيانات</h2>
        <div className="header-actions">
          <button className="header-btn" onClick={handleExportReport}>
            <IconDownload /> تصدير التقرير
          </button>
        </div>
      </div>

      <div className="analytics-container">
        {/* Summary cards */}
        <div className="analytics-summary">
          {stats.summary.map((s) => (
            <div key={s.label} className="analytics-stat-card">
              <div className="analytics-stat-value" style={{ color: s.color || 'var(--accent)' }}>{s.value}</div>
              <div className="analytics-stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="analytics-grid">
          {/* Intent distribution */}
          <div className="analytics-card">
            <h3>توزيع الأهداف (Intent)</h3>
            {stats.intentDistribution.length === 0 ? (
              <p className="analytics-empty-text">لا توجد بيانات بعد</p>
            ) : (
              <div className="bar-chart">
                {stats.intentDistribution.map((item) => (
                  <div key={item.label} className="bar-row">
                    <span className="bar-label">{item.label}</span>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ width: `${item.percentage}%` }}
                      />
                    </div>
                    <span className="bar-value">{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top keywords */}
          <div className="analytics-card">
            <h3>الكلمات المفتاحية الأكثر تكراراً</h3>
            {stats.topKeywords.length === 0 ? (
              <p className="analytics-empty-text">لا توجد كلمات مفتاحية بعد</p>
            ) : (
              <div className="keyword-cloud">
                {stats.topKeywords.map((kw) => (
                  <span
                    key={kw.word}
                    className="keyword-chip"
                    style={{ fontSize: `${12 + Math.min(kw.count * 2, 12)}px`, opacity: 0.6 + Math.min(kw.count / 5, 0.4) }}
                  >
                    {kw.word} <span className="keyword-count">{kw.count}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Tag distribution */}
          <div className="analytics-card">
            <h3>توزيع الوسوم في قاعدة المعرفة</h3>
            {stats.tagDistribution.length === 0 ? (
              <p className="analytics-empty-text">لا توجد وسوم بعد</p>
            ) : (
              <div className="tag-bars">
                {stats.tagDistribution.map((t) => (
                  <div key={t.tag} className="tag-bar-item">
                    <span className="kb-tag">{t.tag}</span>
                    <span className="tag-bar-count">{t.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Activity timeline */}
          <div className="analytics-card">
            <h3>النشاط الزمني (آخر 7 أيام)</h3>
            {stats.timeline.length === 0 ? (
              <p className="analytics-empty-text">لا يوجد نشاط بعد</p>
            ) : (
              <div className="timeline-chart">
                {stats.timeline.map((day) => (
                  <div key={day.date} className="timeline-day">
                    <div className="timeline-bars">
                      <div
                        className="timeline-bar timeline-bar-user"
                        style={{ height: `${day.userHeight}px` }}
                        title={`رسائل المستخدم: ${day.userCount}`}
                      />
                      <div
                        className="timeline-bar timeline-bar-assistant"
                        style={{ height: `${day.assistantHeight}px` }}
                        title={`ردود Zazo: ${day.assistantCount}`}
                      />
                    </div>
                    <span className="timeline-label">{day.shortDate}</span>
                  </div>
                ))}
                <div className="timeline-legend">
                  <span className="legend-item"><span className="legend-dot legend-user" /> المستخدم</span>
                  <span className="legend-item"><span className="legend-dot legend-assistant" /> Zazo</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function computeStats(conversations, messages, knowledge) {
  const userMessages = messages.filter((m) => m.role === 'user')
  const assistantMessages = messages.filter((m) => m.role === 'assistant')

  // Intent distribution
  const intentCounts = {}
  messages.forEach((m) => {
    const intent = m.metadata?.intent
    if (intent) intentCounts[intent] = (intentCounts[intent] || 0) + 1
  })
  const totalIntents = Object.values(intentCounts).reduce((a, b) => a + b, 0)
  const intentDistribution = Object.entries(intentCounts)
    .map(([label, count]) => ({
      label,
      count,
      percentage: totalIntents > 0 ? Math.round((count / totalIntents) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)

  // Top keywords
  const keywordCounts = {}
  messages.forEach((m) => {
    const kws = m.metadata?.keywords
    if (Array.isArray(kws)) {
      kws.forEach((kw) => {
        keywordCounts[kw] = (keywordCounts[kw] || 0) + 1
      })
    }
  })
  const topKeywords = Object.entries(keywordCounts)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

  // Tag distribution
  const tagCounts = {}
  knowledge.forEach((e) => {
    (e.tags || []).forEach((t) => {
      tagCounts[t] = (tagCounts[t] || 0) + 1
    })
  })
  const tagDistribution = Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)

  // Timeline (last 7 days)
  const days = []
  const today = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split('T')[0]
    days.push({
      date: dateStr,
      shortDate: d.toLocaleDateString('ar-EG', { weekday: 'short' }),
      userCount: 0,
      assistantCount: 0,
    })
  }
  const dayMap = {}
  days.forEach((d) => { dayMap[d.date] = d })
  messages.forEach((m) => {
    const dateStr = m.created_at?.split('T')[0]
    if (dayMap[dateStr]) {
      if (m.role === 'user') dayMap[dateStr].userCount++
      else dayMap[dateStr].assistantCount++
    }
  })
  const maxCount = Math.max(...days.map((d) => Math.max(d.userCount, d.assistantCount)), 1)
  days.forEach((d) => {
    d.userHeight = Math.round((d.userCount / maxCount) * 80)
    d.assistantHeight = Math.round((d.assistantCount / maxCount) * 80)
  })

  const summary = [
    { label: 'المحادثات', value: conversations.length },
    { label: 'إجمالي الرسائل', value: messages.length },
    { label: 'رسائل المستخدم', value: userMessages.length, color: '#3b82f6' },
    { label: 'ردود Zazo', value: assistantMessages.length, color: 'var(--accent)' },
    { label: 'مدخلات المعرفة', value: knowledge.length },
    { label: 'وسوم فريدة', value: tagDistribution.length },
  ]

  return { summary, intentDistribution, topKeywords, tagDistribution, timeline: days }
}
