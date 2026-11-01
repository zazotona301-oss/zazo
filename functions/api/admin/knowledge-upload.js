const BACKEND_UPLOAD_URL = 'https://zazo-brain-backend.zazotona301.workers.dev/api/admin/knowledge-upload'

export async function onRequestGet({ request }) {
  const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!accessJwt) return Response.json({ error: 'access_required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  const popup = new URL(request.url).searchParams.get('popup') === '1'
  if (popup) {
    const html = '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>تم تسجيل الدخول</title><body><p>تم التحقق من تسجيل الدخول. ارجع إلى Zazo لإكمال الرفع.</p><script>window.close()</script></body></html>'
    return new Response(html, { headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' } })
  }
  return Response.json({ authenticated: true }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function onRequestPost({ request }) {
  const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!accessJwt) return Response.json({ error: 'access_required', message: 'سجّل الدخول عبر Cloudflare Access أولاً.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  const contentType = request.headers.get('Content-Type')
  if (!contentType?.toLowerCase().startsWith('multipart/form-data;')) return Response.json({ error: 'validation_error', message: 'يجب إرسال الملف بصيغة multipart/form-data.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  try {
    const upstream = await fetch(BACKEND_UPLOAD_URL, {
      method: 'POST',
      headers: { 'Cf-Access-Jwt-Assertion': accessJwt, Accept: 'application/json', 'Content-Type': contentType },
      body: request.body,
    })
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: { 'Cache-Control': 'no-store', 'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8' } })
  } catch {
    return Response.json({ error: 'backend_unavailable', message: 'تعذر الوصول إلى خدمة مكتبة المعرفة؛ لم يؤكد الخادم حفظ الملف.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
