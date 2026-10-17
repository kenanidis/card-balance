export type ApprovalStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED'

export interface CardData {
  cardNumber: string
  extraCode: string
  pointsNumber: string
}

export interface BalanceSnapshot {
  cents: number
  formatted: string
  checkedAt: number
}

export interface HistoryEntry {
  id: string
  previousCents: number
  newCents: number
  changedAt: number
}

export interface LocalState {
  card: CardData
  balance: BalanceSnapshot | null
  history: HistoryEntry[]
  termsAccepted: boolean
  lastManualRefreshes: number[]
}

export const EMPTY_STATE: LocalState = {
  card: { cardNumber: '', extraCode: '', pointsNumber: '' },
  balance: null,
  history: [],
  termsAccepted: false,
  lastManualRefreshes: []
}
