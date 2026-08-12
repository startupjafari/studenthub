import type { PortfolioKind, PortfolioVisibility } from '@studenthub/shared-schemas'
export type { PortfolioKind, PortfolioVisibility }

export interface PortfolioItem {
  id: string
  kind: PortfolioKind
  title: string
  organization: string | null
  description: string | null
  url: string | null
  startDate: string | null
  endDate: string | null
  visibility: PortfolioVisibility
  order: number
  createdAt: string
}
