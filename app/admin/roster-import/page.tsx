import type { Metadata } from 'next'
import { RosterImporter } from './roster-importer'

export const metadata: Metadata = {
  title: 'Import Seniority Roster | ZLA Bidding',
}

export default function RosterImportPage() {
  return <RosterImporter />
}
