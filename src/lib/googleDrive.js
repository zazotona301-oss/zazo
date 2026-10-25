const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,size'
const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client'

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID || '').trim()
const FOLDER_ID = (import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID || '').trim()
let scriptPromise
let tokenClient
let accessToken

async function uploadViaAndroidBridge({ file, uploadId }) {
  const bridge = globalThis.AndroidZazoLocal
  if (!bridge || typeof bridge.uploadTrainingFile !== 'function') return null
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
  }
  const base64 = btoa(binary)
  const callbackName = `__zazoDriveNative_${Date.now()}_${Math.random().toString(36).slice(2)}`
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      delete globalThis[callbackName]
      reject(new Error('انتهت مهلة رفع الملف من تطبيق Android'))
    }, 180_000)
    globalThis[callbackName] = (payload) => {
      clearTimeout(timeout)
      delete globalThis[callbackName]
      try {
        const result = JSON.parse(payload)
        if (!result.ok) {
          reject(new Error(result.error || 'فشل رفع الملف إلى Google Drive'))
          return
        }
        resolve(result.file)
      } catch {
        reject(new Error('استجابة غير صالحة من Google Drive داخل Android'))
      }
    }
    bridge.uploadTrainingFile(
      `zazo-training-${uploadId || Date.now()}-${file.name}`,
      file.type || 'application/octet-stream',
      base64,
      callbackName,
    )
  })
}

function loadGoogleIdentity() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve()
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`)
      if (existing) {
        existing.addEventListener('load', resolve, { once: true })
        existing.addEventListener('error', () => reject(new Error('تعذر تحميل Google Identity Services')), { once: true })
        return
      }
      const script = document.createElement('script')
      script.src = GOOGLE_IDENTITY_SCRIPT
      script.async = true
      script.defer = true
      script.onload = resolve
      script.onerror = () => reject(new Error('تعذر تحميل Google Identity Services'))
      document.head.appendChild(script)
    })
  }
  return scriptPromise
}

function requireConfiguration() {
  if (!CLIENT_ID || !FOLDER_ID) {
    throw new Error('لم يتم إعداد Google Drive بعد؛ أضف VITE_GOOGLE_DRIVE_CLIENT_ID وVITE_GOOGLE_DRIVE_FOLDER_ID إلى إعدادات الواجهة.')
  }
}

async function requestDriveToken() {
  requireConfiguration()
  await loadGoogleIdentity()
  if (!tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: () => {},
    })
  }
  return new Promise((resolve, reject) => {
    tokenClient.callback = (response) => {
      if (response?.error) {
        reject(new Error(`فشل تسجيل الدخول إلى Google Drive: ${response.error}`))
        return
      }
      accessToken = response.access_token
      resolve(accessToken)
    }
    tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' })
  })
}

function multipartBody(metadata, file) {
  const boundary = `zazo-drive-${crypto.randomUUID()}`
  const encoder = new TextEncoder()
  const prefix = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
  )
  const suffix = encoder.encode(`\r\n--${boundary}--`)
  return {
    boundary,
    body: new Blob([prefix, file, suffix], { type: `multipart/related; boundary=${boundary}` }),
  }
}

export function isGoogleDriveConfigured() {
  return Boolean(CLIENT_ID && FOLDER_ID)
}

export async function uploadTrainingFileToDrive({ file, uploadId, worldId }) {
  if (!file) throw new Error('اختر ملف التدريب أولًا')
  const nativeResult = await uploadViaAndroidBridge({ file, uploadId })
  if (nativeResult) return nativeResult
  const token = await requestDriveToken()
  const metadata = {
    name: `zazo-training-${uploadId || Date.now()}-${file.name}`,
    parents: [FOLDER_ID],
    description: JSON.stringify({ source: 'zazo', uploadId, worldId: worldId || null }),
  }
  const multipart = multipartBody(metadata, file)
  const response = await fetch(DRIVE_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${multipart.boundary}`,
    },
    body: multipart.body,
  })
  const payload = await response.json().catch(() => ({}))
  if (response.status === 401) {
    accessToken = null
    throw new Error('انتهت جلسة Google Drive؛ اضغط زر الرفع مرة أخرى لتسجيل الدخول مجددًا.')
  }
  if (!response.ok) {
    throw new Error(payload.error?.message || `فشل رفع الملف إلى Google Drive (${response.status})`)
  }
  return payload
}
