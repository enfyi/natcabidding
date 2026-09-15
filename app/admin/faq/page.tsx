import type { Metadata } from 'next'
import { FaqAdmin } from './faq-admin'

export const metadata: Metadata = {
  title: 'FAQ & MOUs | ZLA Bidding',
}

export default function FaqAdminPage() {
  return <FaqAdmin />
}
