const INPUT_KEYS = ['instruction', 'input', 'prompt', 'question', 'query', 'user', 'text', 'content']
const CONTEXT_KEYS = ['context', 'system', 'background', 'metadata', 'notes']
const OUTPUT_KEYS = ['response', 'output', 'answer', 'completion', 'assistant', 'target', 'label']

export function parseTrainingSource(text, filename = '') {
  const normalizedText = text.replace(/^\uFEFF/, '')
  const sourceType = detectSourceType(filename, normalizedText)
  if (sourceType === 'json') return normalizeJson(JSON.parse(normalizedText), filename)
  if (sourceType === 'jsonl') return normalizedText.split(/\r?\n/).filter((line) => line.trim()).flatMap((line, index) => normalizeRecords(JSON.parse(line), filename, index + 1))
  if (sourceType === 'csv' || sourceType === 'tsv') return parseDelimited(normalizedText, sourceType === 'tsv' ? '\t' : ',', filename)
  if (sourceType === 'markdown') return parseMarkdown(normalizedText, filename)
  return parsePlainText(normalizedText, filename)
}

export function normalizeRecord(record, sourceName = '', sourceRow = null) {
  if (typeof record === 'string') {
    return { instruction: record.trim(), context: '', response: '', tags: [], metadata: buildMetadata(sourceName, sourceRow, true) }
  }

  const object = record && typeof record === 'object' ? record : {}
  if (Array.isArray(object.messages)) {
    let lastUser = null
    let pairedAssistant = null
    for (const message of object.messages) {
      if (message?.role === 'user') {
        lastUser = message
        pairedAssistant = null
      } else if (message?.role === 'assistant' && lastUser && !pairedAssistant) {
        pairedAssistant = message
      }
    }
    const instruction = typeof lastUser?.content === 'string' ? lastUser.content.trim() : ''
    const response = typeof pairedAssistant?.content === 'string' ? pairedAssistant.content.trim() : ''
    if (instruction || response) {
      return {
        instruction,
        context: '',
        response,
        tags: normalizeTags(object.tags || object.tag || object.labels),
        metadata: buildMetadata(sourceName, sourceRow, !instruction || !response),
      }
    }
  }
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
  return records.flatMap((record, index) => normalizeRecords(record, sourceName, index + 1))
}

function normalizeRecords(record, sourceName, sourceRow) {
  const object = record && typeof record === 'object' ? record : {}
  if (!Array.isArray(object.messages)) return [normalizeRecord(record, sourceName, sourceRow)]

  const tags = normalizeTags(object.tags || object.tag || object.labels)
  const history = []
  const records = []
  let pendingUser = ''
  for (const message of object.messages) {
    const content = typeof message?.content === 'string' ? message.content.trim() : ''
    if (!content) continue
    if (message.role === 'user') {
      if (pendingUser) history.push({ role: 'user', content: pendingUser })
      pendingUser = content
    } else if (message.role === 'assistant' && pendingUser) {
      const context = history.slice(-8).map((turn) => `${turn.role === 'user' ? 'سؤال سابق من المستخدم' : 'إجابة سابقة من المساعد'}: ${turn.content}`).join('\n\n').slice(0, 20_000)
      records.push(normalizeRecord({ instruction: pendingUser, context, response: content, tags }, sourceName, sourceRow))
      history.push({ role: 'user', content: pendingUser }, { role: 'assistant', content })
      pendingUser = ''
    }
  }
  return records.length ? records : [normalizeRecord(record, sourceName, sourceRow)]
}

function parseDelimited(text, delimiter, sourceName) {
  const rows = parseDelimitedRows(text, delimiter).filter((row) => row.some((value) => value.trim()))
  if (rows.length < 2) return parsePlainText(text, sourceName)
  const headers = rows.shift().map((header) => header.trim().toLowerCase())
  if (new Set(headers).size !== headers.length) throw new Error('CSV/TSV column names must be unique')
  if (!headers.some((header) => INPUT_KEYS.includes(header)) || !headers.some((header) => OUTPUT_KEYS.includes(header))) {
    throw new Error('CSV/TSV needs instruction/question and response/answer columns')
  }
  return rows.map((line, index) => {
    const values = line
    const record = Object.fromEntries(headers.map((header, i) => [header, values[i] || '']))
    return normalizeRecord(record, sourceName, index + 2)
  })
}

function parseDelimitedRows(text, delimiter) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1 }
      else quoted = !quoted
    } else if (character === delimiter && !quoted) {
      row.push(value)
      value = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(value)
      rows.push(row)
      row = []
      value = ''
    } else {
      value += character
    }
  }
  if (quoted) throw new Error('CSV/TSV contains an unclosed quoted field')
  if (value || row.length) { row.push(value); rows.push(row) }
  return rows
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
