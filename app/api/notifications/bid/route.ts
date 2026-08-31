import { createClient } from '@supabase/supabase-js'
import { getBidNotificationSender, getEmailTransporter } from '@/lib/email'
import { getSupabaseEnv } from '@/lib/env'

const NOTIFICATION_KINDS = new Set(['submitted', 'approved', 'denied'])
const INITIALS_PATTERN = /^[A-Z0-9-]{1,12}$/

type NotificationRequest = {
  kind?: unknown
  eventId?: unknown
  initials?: unknown
  area?: unknown
  subject?: unknown
  body?: unknown
}

function normalizedText(value: unknown, maximumLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maximumLength) : ''
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || ''
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
}

function serverSupabaseClient(key: string, token?: string) {
  const { url } = getSupabaseEnv()

  return createClient(url, key, {
    global: token
      ? {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      : undefined,
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}

export async function POST(request: Request) {
  const token = bearerToken(request)
  if (!token) {
    return Response.json({ error: 'Sign in before sending notifications.' }, { status: 401 })
  }

  let payload: NotificationRequest
  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'The notification request is invalid.' }, { status: 400 })
  }

  const kind = normalizedText(payload.kind, 20)
  const eventId = normalizedText(payload.eventId, 120)
  const initials = normalizedText(payload.initials, 12).toUpperCase()
  const area = normalizedText(payload.area, 80)
  const subject = normalizedText(payload.subject, 200)
  const body = normalizedText(payload.body, 10_000)

  if (
    !NOTIFICATION_KINDS.has(kind) ||
    !eventId ||
    !INITIALS_PATTERN.test(initials) ||
    !area ||
    !subject ||
    !body
  ) {
    return Response.json({ error: 'Required notification details are missing.' }, { status: 400 })
  }

  const { publishableKey } = getSupabaseEnv()
  const authClient = serverSupabaseClient(publishableKey, token)
  const { data: userData, error: userError } = await authClient.auth.getUser(token)
  const user = userData.user

  if (userError || !user) {
    return Response.json({ error: 'Your session is invalid or expired.' }, { status: 401 })
  }

  const recipientResult = await authClient
    .rpc('resolve_bid_notification_recipient', {
      notification_area: area,
      notification_initials: initials,
    })
    .maybeSingle()
  const recipient = recipientResult.data as { recipient_email: string | null } | null
  const recipientError = recipientResult.error

  if (recipientError || !recipient?.recipient_email) {
    return Response.json({ error: 'You cannot notify this bidder.' }, { status: 403 })
  }

  try {
    const transporter = getEmailTransporter()
    const result = await transporter.sendMail({
      from: getBidNotificationSender(),
      to: recipient.recipient_email,
      subject,
      text: body,
      headers: {
        'X-ZLA-Notification-ID': `bid-${kind}-${eventId}`,
      },
    })

    return Response.json({ id: result.messageId, recipient: recipient.recipient_email })
  } catch (error) {
    console.error('[email] Gmail bid notification could not be sent.', error)
    return Response.json({ error: 'Email notifications are not configured.' }, { status: 503 })
  }
}
