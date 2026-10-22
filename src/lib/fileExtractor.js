import { parseTrainingSource } from './dataParser'

export async function extractFileText(file) {
  const extension = file.name.toLowerCase().split('.').pop()
  if (['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'ndjson'].includes(extension)) return file.text()
  if (['html', 'htm'].includes(extension)) return stripHtml(await file.text())
  if (extension === 'pdf') return extractPdf(file)
  if (extension === 'docx') return extractDocx(file)
  if (extension === 'epub') return extractEpub(file)
  throw new Error(`الصيغة غير مدعومة بعد: .${extension}`)
}

export async function extractBookRecords(file) {
  const text = await extractFileText(file)
  if (!text.trim()) throw new Error('لم يتم العثور على نص قابل للاستخراج')
  return parseTrainingSource(text, file.name)
}

async function extractPdf(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableWorker: true }).promise
  const pages = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    pages.push(content.items.map((item) => item.str || '').join(' '))
  }
  return pages.join('\n\n')
}

async function extractDocx(file) {
  const module = await import('mammoth')
  const mammoth = module.default || module
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  return result.value
}

async function extractEpub(file) {
  const module = await import('jszip')
  const JSZip = module.default || module
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const container = await zip.file('META-INF/container.xml')?.async('string')
  if (!container) throw new Error('ملف EPUB لا يحتوي على container.xml')
  const rootfile = container.match(/rootfile[^>]+full-path=["']([^"']+)["']/i)?.[1]
  if (!rootfile) throw new Error('تعذر تحديد محتوى EPUB')
  const opf = await zip.file(rootfile)?.async('string')
  if (!opf) throw new Error('تعذر قراءة ملف EPUB الداخلي')
  const base = rootfile.includes('/') ? rootfile.slice(0, rootfile.lastIndexOf('/') + 1) : ''
  const manifest = new Map([...opf.matchAll(/<item\b[^>]*href=["']([^"']+)["'][^>]*media-type=["']application\/(xhtml\+xml|xml|html)["'][^>]*>/gi)].map((match) => [match[1], true]))
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1])
  const ids = new Map([...opf.matchAll(/<item\b[^>]*id=["']([^"']+)["'][^>]*href=["']([^"']+)["'][^>]*>/gi)].map((match) => [match[1], match[2]]))
  const chapters = []
  for (const id of spine) {
    const href = ids.get(id)
    if (!href || !manifest.has(href)) continue
    const html = await zip.file(`${base}${href}`)?.async('string')
    if (html) chapters.push(stripHtml(html))
  }
  return chapters.join('\n\n')
}

function stripHtml(html) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  return (document.body?.textContent || html).replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').trim()
}
