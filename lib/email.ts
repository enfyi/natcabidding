import nodemailer from 'nodemailer'

function requiredServerValue(name: string) {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`[email] ${name} is not configured.`)
  }

  return value
}

export function getEmailTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: requiredServerValue('GMAIL_USER'),
      pass: requiredServerValue('GMAIL_APP_PASSWORD'),
    },
  })
}

export function getBidNotificationSender() {
  return {
    name: process.env.BID_NOTIFICATION_FROM_NAME?.trim() || 'ZLA Bidding',
    address: requiredServerValue('GMAIL_USER'),
  }
}
