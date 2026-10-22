const INPUT_KEYS = ['instruction', 'input', 'prompt', 'question', 'query', 'user', 'text', 'content']
const CONTEXT_KEYS = ['context', 'system', 'background', 'metadata', 'notes']
const OUTPUT_KEYS = ['response', 'output', 'answer', 'completion', 'assistant', 'target', 'label']

export function parseTrainingSource(text, filename = '') {
  const sourceType = detectSourceType(filename, text)
  if (sourceType === 'json') return normalizeJson(JSON.parse(text), filename)
  if (sourceType === 'jsonl') return text.split(/\r?\n/).filter(Boolean).map((line, index) => normalizeRecord(JSON.parse(line), filename, index + 1))
  if (sourceType === 'csv' || sourceType === 'tsv') return parseDelimited(text, sourceType === 'tsv' ? '\t' : ',', filename)
  if (sourceType === 'markdown') return parseMarkdown(text, filename)
  return parsePlainText(text, filename)
}

export function normalizeRecord(record, sourceName = '', sourceRow = null) {
  if (typeof record === 'string') {
    return { instruction: record.trim(), context: '', response: '', tags: [], metadata: buildMetadata(sourceName, sourceRow, true) }
  }

  const object = record && typeof record === 'object' ? record : {}
  const read = (keys) => {
    const key = keys.find((candidate) => object[candidate] !== undefined && object[candidate] !== null)
    const value = key ? object[key] : ''
    return typeof value === 'string' ? value.trim() : JSON.stringify(value)
  }
  const tags = normalizeTags(object.tags || object.tag || object.labels)
  return {
    instruction: read(INPUT_KEYS),
    context: read(CONTEXT_KEYS),
    response: read(OUTPUT_KEYS),
    tags,
    metadata: buildMetadata(sourceName, sourceRow, false),
  }
}

function normalizeJson(value, sourceName) {
  const records = Array.isArray(value) ? value : (Array.isArray(value.data) ? value.data : [value])
  return records.map((record, index) => normalizeRecord(record, sourceName, index + 1))
}

function parseDelimited(text, delimiter, sourceName) {
  const rows = text.split(/\r?\n/).filter((line) => line.trim())
  if (rows.length < 2) return parsePlainText(text, sourceName)
  const headers = splitDelimitedLine(rows.shift(), delimiter).map((header) => header.trim().toLowerCase())
  return rows.map((line, index) => {
    const values = splitDelimitedLine(line, delimiter)
    const record = Object.fromEntries(headers.map((header, i) => [header, values[i] || '']))
    return normalizeRecord(record, sourceName, index + 2)
  })
}

function splitDelimitedLine(line, delimiter) {
  const values = []
  let value = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"' && line[i + 1] === '"') { value += '"'; i += 1; continue }
    if (char === '"') { quoted = !quoted; continue }
    if (char === delimiter && !quoted) { values.push(value); value = ''; continue }
    value += char
  }
  values.push(value)
  return values
}

function parseMarkdown(text, sourceName) {
  const sections = text.split(/^#{1,6}\s+/m).filter(Boolean)
  return sections.map((section, index) => {
    const lines = section.trim().split(/\r?\n/)
    const heading = lines.shift()?.trim() || `Markdown section ${index + 1}`
    return normalizeRecord({ instruction: heading, context: '', response: lines.join('\n').trim() }, sourceName, index + 1)
  })
}

function parsePlainText(text, sourceName) {
  return text.split(/\n\s*\n/).map((block, index) => normalizeRecord(block.trim(), sourceName, index + 1)).filter((item) => item.instruction)
}

function detectSourceType(filename, text) {
  const extension = filename.toLowerCase().split('.').pop()
  if (extension === 'jsonl' || extension === 'ndjson') return 'jsonl'
  if (extension === 'json') return 'json'
  if (extension === 'csv') return 'csv'
  if (extension === 'tsv') return 'tsv'
  if (extension === 'md' || extension === 'markdown') return 'markdown'
  const trimmed = text.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return 'json'
  return 'text'
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(String).map((tag) => tag.trim()).filter(Boolean)
  return String(value || '').split(/[,،|]/).map((tag) => tag.trim()).filter(Boolean)
}

function buildMetadata(sourceName, sourceRow, needsReview) {
  return { ingestion: 'data_analyst', source_name: sourceName || 'manual', source_row: sourceRow, needs_review: needsReview }
}
