export async function onRequestGet({ request }) {
  if (!request.headers.get('Cf-Access-Jwt-Assertion')) {
    return new Response('Cloudflare Access login is required.', {
      status: 401,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>تم تسجيل الدخول إلى Zazo</title>
    <style>
      body{font-family:system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:24px;line-height:1.8;color:#18212f}
      main{border:1px solid #d8dee8;border-radius:16px;padding:28px;background:#f8fafc}
      h1{font-size:1.5rem}p{color:#465264}
    </style>
  </head>
  <body>
    <main>
      <h1>تم التحقق من تسجيل الدخول</h1>
      <p>يمكنك إغلاق هذه النافذة والعودة إلى صفحة الإدارة في Zazo لمتابعة الرفع الذي طلبته.</p>
    </main>
  </body>
</html>`
  return new Response(html, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
