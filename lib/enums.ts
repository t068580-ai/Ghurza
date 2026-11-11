// SQLite in Prisma 5 has no native enums, so these columns are Strings.
// The allowed values live here, once, and zod enforces them on every write.
// Critical ones are re-checked by triggers in prisma/sql/triggers.sql.

export const ROLES = ['CUSTOMER', 'TAILOR'] as const
export type Role = (typeof ROLES)[number]

export const PIECE_TYPES = ['ABAYA', 'THOBE', 'DISHDASHA', 'BISHT', 'EVENING_GOWN', 'SUIT', 'ALTERATIONS', 'OTHER'] as const
export type PieceType = (typeof PIECE_TYPES)[number]
export const PIECE_LABELS: Record<PieceType, string> = {
  ABAYA: 'Abaya',
  THOBE: 'Thobe',
  DISHDASHA: 'Dishdasha',
  BISHT: 'Bisht',
  EVENING_GOWN: 'Evening gown',
  SUIT: 'Suit',
  ALTERATIONS: 'Alterations',
  OTHER: 'Other',
}

export const REQUEST_STATUS = ['OPEN', 'AWARDED', 'CANCELLED'] as const
export const BID_STATUS = ['PENDING', 'DECLINED', 'ACCEPTED', 'LOST'] as const
export const PAYMENT_KIND = ['UPFRONT', 'COMPLETION'] as const
export const PAYMENT_STATUS = ['PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUND_DUE'] as const
export const ORDER_STATUS = ['ACCEPTED', 'IN_PROGRESS', 'READY', 'COMPLETED'] as const
export type OrderStatus = (typeof ORDER_STATUS)[number]
export const ORDER_LABELS: Record<OrderStatus, string> = {
  ACCEPTED: 'Accepted',
  IN_PROGRESS: 'In progress',
  READY: 'Ready',
  COMPLETED: 'Completed',
}
export const UPLOAD_KIND = ['REQUEST_REFERENCE', 'ORDER_FINISHED'] as const
export type UploadKind = (typeof UPLOAD_KIND)[number]

export function pieceLabel(v: string): string {
  return (PIECE_LABELS as Record<string, string>)[v] ?? v
}
