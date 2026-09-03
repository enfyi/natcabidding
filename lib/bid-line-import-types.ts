export type BidLineImportRow = {
  sourceRow: number
  line_code: string
  line_type: 'CPC' | 'DEV'
  pattern: string
  fatigue_group: 'A' | 'B' | 'C' | 'C only' | null
  mid: 'No' | 'BID'
  aws: boolean | null
  four_ten: boolean
  flex: boolean | null
  days: [string, string, string, string, string, string, string]
}

export type BidLineImportPreview = {
  fileName: string
  lines: BidLineImportRow[]
  warnings: string[]
}
