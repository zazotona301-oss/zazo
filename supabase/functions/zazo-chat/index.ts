import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { messages = [], mode = 'chat' } = await request.json()
    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: 'messages are required' }, 400)
    }

    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return json({ error: 'Model service is not configured' }, 503)

    const model = Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini'
    const system = mode === 'data_analyst'
      ? 'أنت محلل بيانات Zazo. حوّل الأفكار والنصوص إلى بنية واضحة، اذكر الحقول الناقصة، ولا تخترع إجابات غير موجودة.'
      : 'أنت وعي Zazo. أجب بالعربية بوضوح وتقنية، وكن صريحاً بشأن حدود التنفيذ.'

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [{ role: 'system', content: system }, ...messages.slice(-20)],
      }),
    })

    if (!response.ok) {
      const detail = await response.text()
      console.error('model_error', response.status, detail)
      return json({ error: 'Model request failed' }, 502)
    }

    const payload = await response.json()
    const content = payload.choices?.[0]?.message?.content?.trim()
    if (!content) return json({ error: 'Model returned an empty response' }, 502)
    return json({ content, metadata: { source: 'zazo-chat', model, mode } })
  } catch (error) {
    console.error('zazo-chat error', error)
    return json({ error: 'Invalid request' }, 400)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
