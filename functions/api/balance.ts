import { createRemoteJWKSet, jwtVerify } from 'jose'

interface Env {
  FIREBASE_PROJECT_ID: string
  BALANCE_UPSTREAM_URL?: string
  ALLOWED_ORIGIN?: string
  BALANCE_RATE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>
  }
}

interface PagesContext {
  request: Request
  env: Env
}

interface CloudflareRequestInit extends RequestInit {
  cf?: { cacheTtl: number }
}

interface BalanceRequest {
  requestId?: string
  cardNumber?: string
  extraCode?: string
}

const FIREBASE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'))

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  }
}

function json(body: unknown, status = 200, origin = ''): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...(origin ? corsHeaders(origin) : {})
    }
  })
}

async function approved(requestId: string, token: string, projectId: string, uid: string): Promise<boolean> {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/installationRequests/${encodeURIComponent(requestId)}`
  const options: CloudflareRequestInit = { headers: { Authorization: `Bearer ${token}` }, cf: { cacheTtl: 0 } }
  const response = await fetch(url, options)
  if (!response.ok) return false
  const document = await response.json() as { fields?: Record<string, { stringValue?: string }> }
  return document.fields?.uid?.stringValue === uid &&
    document.fields?.status?.stringValue === 'APPROVED' &&
    document.fields?.clientPlatform?.stringValue === 'WEB'
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const allowedOrigin = context.env.ALLOWED_ORIGIN || 'https://kenanidis.github.io'
  const origin = context.request.headers.get('Origin') || ''
  if (origin !== allowedOrigin) return json({ error: 'Μη επιτρεπτή προέλευση.' }, 403)
  let stage = 'authenticate'
  try {
    const authorization = context.request.headers.get('Authorization') || ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (!token) return json({ error: 'Απαιτείται σύνδεση.' }, 401, origin)
    const projectId = context.env.FIREBASE_PROJECT_ID || 'card-balance-2cdf0'
    const { payload } = await jwtVerify(token, FIREBASE_KEYS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId
    })
    if (!payload.sub) return json({ error: 'Μη έγκυρη ταυτότητα.' }, 401, origin)
    if (context.env.BALANCE_RATE_LIMITER) {
      stage = 'rate-limit'
      const { success } = await context.env.BALANCE_RATE_LIMITER.limit({ key: payload.sub })
      if (!success) return json({ error: 'Έγιναν πολλές προσπάθειες. Δοκιμάστε ξανά σε λίγο.' }, 429, origin)
    }
    stage = 'request-validation'
    const body = await context.request.json() as BalanceRequest
    if (!body.requestId || !/^[a-f0-9]{64}$/.test(body.requestId)) return json({ error: 'Μη έγκυρο αίτημα.' }, 400, origin)
    if (!body.cardNumber || !/^\d{1,30}$/.test(body.cardNumber)) return json({ error: 'Ελέγξτε τον αριθμό διατακτικής.' }, 400, origin)
    if (!body.extraCode || !/^\d{6}$/.test(body.extraCode)) return json({ error: 'Ο κωδικός πρέπει να έχει 6 ψηφία.' }, 400, origin)
    stage = 'approval-check'
    if (!await approved(body.requestId, token, projectId, payload.sub)) return json({ error: 'Η εγκατάσταση δεν είναι εγκεκριμένη.' }, 403, origin)
    const upstream = context.env.BALANCE_UPSTREAM_URL || 'https://vouchercards.ab.gr/api/Balance/CheckBalance'
    const upstreamOptions: CloudflareRequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ cardCode: body.cardNumber, extraCode: body.extraCode }),
      redirect: 'error',
      cf: { cacheTtl: 0 }
    }
    stage = 'upstream-request'
    const response = await fetch(upstream, upstreamOptions)
    if (!response.ok) return json({ error: 'Η υπηρεσία υπολοίπου δεν είναι διαθέσιμη.' }, 502, origin)
    stage = 'upstream-response'
    const upstreamBody = await response.json() as Record<string, unknown>
    const raw = upstreamBody.CurrentPrePaidLimit ?? upstreamBody.currentPrePaidLimit
    const amount = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'))
    if (!Number.isFinite(amount)) return json({ error: 'Μη αναμενόμενη απάντηση υπηρεσίας.' }, 502, origin)
    const cents = Math.round(amount * 100)
    return json({ cents, formatted: new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(cents / 100) }, 200, origin)
  } catch (error) {
    const diagnostic = error instanceof Error
      ? { name: error.name, message: error.message.slice(0, 300) }
      : { name: 'UnknownError', message: 'No error details' }
    console.error('balance-api-failure', { stage, ...diagnostic })
    return json({ error: 'Ο έλεγχος υπολοίπου απέτυχε.', reference: stage }, 500, origin)
  }
}

export function onRequestOptions(context: PagesContext): Response {
  const allowedOrigin = context.env.ALLOWED_ORIGIN || 'https://kenanidis.github.io'
  const origin = context.request.headers.get('Origin') || ''
  if (origin !== allowedOrigin) return json({ error: 'Μη επιτρεπτή προέλευση.' }, 403)
  return new Response(null, { status: 204, headers: corsHeaders(origin) })
}

export function onRequest(context: PagesContext): Response {
  const allowedOrigin = context.env.ALLOWED_ORIGIN || 'https://kenanidis.github.io'
  const origin = context.request.headers.get('Origin') || ''
  return json({ error: 'Μη επιτρεπτή μέθοδος.' }, 405, origin === allowedOrigin ? origin : '')
}
