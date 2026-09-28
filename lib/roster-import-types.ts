export type RosterImportRow = {
  sourceRow: number
  sourceSheet: string
  profile_id: string | null
  area_code: string
  seniority_rank: number
  first_name: string
  last_name: string
  initials: string
  email: string | null
  phone: string | null
  bid_role: 'CPC' | 'GL' | 'R-DEV' | 'D-DEV' | 'TMC' | 'DEV'
  seniority_date: string | null
  active: boolean
  leave_slot_allowance: number
}

export type RosterImportPreview = {
  fileName: string
  rows: RosterImportRow[]
  warnings: string[]
}

export type RosterImportAction = 'add' | 'update' | 'unchanged' | 'reactivate'
