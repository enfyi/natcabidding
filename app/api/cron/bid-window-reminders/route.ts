import { timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  buildBidWindowReminderEmail,
  type BidWindowReminder,
} from '@/lib/bid-window-reminder-email'
import { getBidNotificationSender, getEmailTransporter } from '@/lib/email'
import { getSiteUrl, getSupabaseEnv } from '@/lib/env'

export const maxDuration = 60

function requiredCronSecret() {
  const secret = process.env.BID_REMINDER_CRON_SECRET?.trim()
  if (!secret) throw new Error('[email] BID_REMINDER_CRON_SECRET is not configured.')
  return secret
}

function validAuthorization(request: Request, expectedSecret: string) {
  const authorization = request.headers.get('authorization') || ''
  const actualSecret = authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : ''
  const actual = Buffer.from(actualSecret)
  const expected = Buffer.from(expectedSecret)

  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function cronSupabaseClient(secret: string) {
  const { url, publishableKey } = getSupabaseEnv()

  return createClient(url, publishableKey, {
    global: {
      headers: {
        'X-Bid-Reminder-Secret': secret,
      },
    },
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function POST(request: Request) {
  let secret: string

  try {
    secret = requiredCronSecret()
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Bid reminder notifications are not configured.' }, { status: 503 })
  }

  if (!validAuthorization(request, secret)) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const client = cronSupabaseClient(secret)
  const claimResult = await client.rpc('claim_due_bid_window_email_reminders')

  if (claimResult.error) {
    console.error('[email] Unable to claim due bid-window reminders.', claimResult.error)
    return Response.json({ error: 'Unable to load due bid-window reminders.' }, { status: 500 })
  }

  const reminders = (claimResult.data || []) as BidWindowReminder[]
  if (!reminders.length) {
    return Response.json({ ok: true, claimed: 0, sent: 0, failed: 0 })
  }

  const transporter = getEmailTransporter()
  const sender = getBidNotificationSender()
  const actionUrl = `${getSiteUrl()}/dashboard`
  let sent = 0
  let failed = 0

  for (const reminder of reminders) {
    const email = buildBidWindowReminderEmail(reminder, actionUrl)
    let delivered = false
    let deliveryError = ''

    try {
      await transporter.sendMail({
        from: sender,
        to: reminder.recipient_email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: {
          'X-ZLA-Notification-ID': `bid-window-${reminder.reminder_type}-${reminder.reminder_id}`,
        },
      })
      delivered = true
      sent += 1
    } catch (error) {
      deliveryError = errorMessage(error).slice(0, 1_000)
      failed += 1
      console.error('[email] Bid-window reminder could not be sent.', {
        reminderId: reminder.reminder_id,
        error: deliveryError,
      })
    }

    const completionResult = await client.rpc('complete_bid_window_email_reminder', {
      reminder_id: reminder.reminder_id,
      delivered,
      delivery_error: deliveryError || null,
    })

    if (completionResult.error) {
      console.error('[email] Bid-window reminder result could not be recorded.', {
        reminderId: reminder.reminder_id,
        error: completionResult.error,
      })
    }
  }

  return Response.json({ ok: failed === 0, claimed: reminders.length, sent, failed })
}
