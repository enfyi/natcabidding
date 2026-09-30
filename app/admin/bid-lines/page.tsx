import type { Metadata } from 'next'
import { BidLineImporter } from './bid-line-importer'

export const metadata: Metadata = {
  title: 'Manage Bid Lines | ZLA Bidding',
}

export default function BidLineImportPage() {
  return <BidLineImporter />
}
