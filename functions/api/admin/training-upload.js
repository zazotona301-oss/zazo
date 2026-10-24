const BACKEND_UPLOAD_URL = 'https://zazo-brain-backend.zazotona301.workers.dev/api/admin/training-upload'

export async function onRequestPost({ request }) {
  const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!accessJwt) {
    return Response.json(
      { error: 'access_required', message: 'سجّل الدخول عبر Cloudflare Access أولًا ثم أعد المحاولة.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const contentType = request.headers.get('Content-Type')
  if (!contentType?.toLowerCase().startsWith('multipart/form-data;')) {
    return Response.json(
      { error: 'validation_error', message: 'يجب إرسال ملف التدريب بصيغة multipart/form-data.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  try {
    const headers = new Headers({
      'Cf-Access-Jwt-Assertion': accessJwt,
      Accept: 'application/json',
      'Content-Type': contentType,
    })
    const upstream = await fetch(BACKEND_UPLOAD_URL, {
      method: 'POST',
      headers,
      body: request.body,
    })
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
      },
    })
  } catch {
    return Response.json(
      { error: 'backend_unavailable', message: 'تعذر الوصول إلى خدمة رفع التدريب. الملف لم يُؤكد حفظه؛ تحقق من النتيجة قبل إعادة المحاولة.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
