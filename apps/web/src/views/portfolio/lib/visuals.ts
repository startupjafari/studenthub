import {
  Award,
  BriefcaseBusiness,
  FolderGit2,
  GraduationCap,
  ScrollText,
  type LucideIcon,
} from 'lucide-react'
import type { PortfolioKind, PortfolioVisibility } from '../../../entities/portfolio'

export const PORTFOLIO_KINDS: PortfolioKind[] = [
  'EDUCATION',
  'EXPERIENCE',
  'PROJECT',
  'CERTIFICATE',
  'ACHIEVEMENT',
]

export const PORTFOLIO_VISIBILITY: PortfolioVisibility[] = ['PRIVATE', 'UNIVERSITY', 'PUBLIC']

// Иконка секции портфолио по виду записи.
export const KIND_ICON: Record<PortfolioKind, LucideIcon> = {
  EDUCATION: GraduationCap,
  EXPERIENCE: BriefcaseBusiness,
  PROJECT: FolderGit2,
  CERTIFICATE: ScrollText,
  ACHIEVEMENT: Award,
}

// Ключ i18n (namespace Portfolio) для вида записи.
export function kindKey(kind: PortfolioKind): string {
  return `kind${kind.charAt(0)}${kind.slice(1).toLowerCase()}`
}

// Ключ i18n (namespace Portfolio) для видимости.
export function visibilityKey(v: PortfolioVisibility): string {
  return `vis${v.charAt(0)}${v.slice(1).toLowerCase()}`
}
