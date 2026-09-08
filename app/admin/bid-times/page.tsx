import type { Metadata } from 'next'
import { BidTimeImporter } from './bid-time-importer'

export const metadata: Metadata = {
  title: 'Import Bid Times | ZLA Bidding',
}

export default function BidTimeImportPage() {
  return <BidTimeImporter />
}
