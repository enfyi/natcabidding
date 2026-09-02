export type BidLineImportRow = {
  sourceRow: number
  line_code: string
  line_type: 'CPC' | 'DEV'
  pattern: string
  fatigue_group: 'A' | 'B' | 'C' | 'C only'
  mid: 'No' | 'BID'
  aws: boolean
  four_ten: boolean
  flex: boolean
  days: [string, string, string, string, string, string, string]
}

export type BidLineImportPreview = {
  fileName: string
  lines: BidLineImportRow[]
  warnings: string[]
}
