const DISPLAY_TIME_ZONE = 'America/Los_Angeles'

export type BidWindowReminder = {
  reminder_id: string
  reminder_type: 'opening_15_minutes' | 'expiring_30_minutes'
  recipient_email: string
  recipient_first_name: string
  recipient_initials: string | null
  area_name: string
  bid_year: number
  round_number: number
  opens_at: string
  closes_at: string
}

type BidWindowReminderEmail = {
  subject: string
  text: string
  html: string
}

function escapeHtml(value: string | number) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function displayDateTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TIME_ZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value))
}

function emailLayout({
  preview,
  heading,
  greeting,
  message,
  windowLabel,
  actionUrl,
}: {
  preview: string
  heading: string
  greeting: string
  message: string
  windowLabel: string
  actionUrl: string
}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;background:#f4f6f8;color:#172033;font-family:Arial,Helvetica,sans-serif;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preview)}</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #dfe4ea;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#0b2d4f;color:#ffffff;padding:20px 28px;font-size:20px;font-weight:700;">ZLA Annual Bidding</td>
            </tr>
            <tr>
              <td style="padding:30px 28px;">
                <h1 style="margin:0 0 18px;font-size:25px;line-height:1.25;color:#0b2d4f;">${escapeHtml(heading)}</h1>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">${escapeHtml(greeting)}</p>
                <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">${escapeHtml(message)}</p>
                <div style="margin:0 0 24px;padding:16px 18px;border-left:4px solid #e7a928;background:#fff8e8;font-size:15px;line-height:1.55;">
                  <strong>Your bid window</strong><br>${escapeHtml(windowLabel)}
                </div>
                <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#0b67a3;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:7px;">Open the bidding website</a>
                <p style="margin:26px 0 0;color:#667085;font-size:13px;line-height:1.5;">If you have already completed your annual bid, no further action is required.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

export function bidWindowOpeningReminderEmail(
  reminder: BidWindowReminder,
  actionUrl: string,
): BidWindowReminderEmail {
  const opensAt = displayDateTime(reminder.opens_at)
  const closesAt = displayDateTime(reminder.closes_at)
  const subject = `Your Round ${reminder.round_number} bid window opens in 15 minutes`
  const message = `Your ${reminder.bid_year} Round ${reminder.round_number} annual leave bid window opens in 15 minutes. Please sign in and be ready to enter your annual bid dates.`
  const windowLabel = `${opensAt} through ${closesAt}`

  return {
    subject,
    text: [
      `Hello ${reminder.recipient_first_name},`,
      '',
      message,
      '',
      `Your bid window: ${windowLabel}`,
      '',
      `Open the bidding website: ${actionUrl}`,
      '',
      'If you have already completed your annual bid, no further action is required.',
    ].join('\n'),
    html: emailLayout({
      preview: subject,
      heading: 'Your bid window opens soon',
      greeting: `Hello ${reminder.recipient_first_name},`,
      message,
      windowLabel,
      actionUrl,
    }),
  }
}

export function bidWindowExpiringReminderEmail(
  reminder: BidWindowReminder,
  actionUrl: string,
): BidWindowReminderEmail {
  const closesAt = displayDateTime(reminder.closes_at)
  const subject = `30 minutes left in your Round ${reminder.round_number} bid window`
  const message = `You have 30 minutes remaining in your ${reminder.bid_year} Round ${reminder.round_number} annual leave bid window. Please enter and submit your annual bid dates before the window closes.`
  const windowLabel = `Closes ${closesAt}`

  return {
    subject,
    text: [
      `Hello ${reminder.recipient_first_name},`,
      '',
      message,
      '',
      `Your bid window: ${windowLabel}`,
      '',
      `Open the bidding website: ${actionUrl}`,
      '',
      'If you have already completed your annual bid, no further action is required.',
    ].join('\n'),
    html: emailLayout({
      preview: subject,
      heading: '30 minutes remain in your bid window',
      greeting: `Hello ${reminder.recipient_first_name},`,
      message,
      windowLabel,
      actionUrl,
    }),
  }
}

export function buildBidWindowReminderEmail(
  reminder: BidWindowReminder,
  actionUrl: string,
) {
  return reminder.reminder_type === 'opening_15_minutes'
    ? bidWindowOpeningReminderEmail(reminder, actionUrl)
    : bidWindowExpiringReminderEmail(reminder, actionUrl)
}
