export type BidTimeImportRow = {
  sourceRow: number
  seniority_rank: number
  initials: string
  round_starts: [string | null, string | null, string | null, string | null]
}

export type BidTimeImportPreview = {
  fileName: string
  bidders: BidTimeImportRow[]
  windowCount: number
  warnings: string[]
}
