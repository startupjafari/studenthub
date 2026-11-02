import type { ReactNode } from 'react'
import { Building2, GraduationCap, type LucideIcon } from 'lucide-react'
import type { FeedPost } from '../../../entities/post'
import { CompanyMark, companyPath } from '../../../entities/company'
import { UniversityMark, universityPath } from '../../../entities/university'

/** Организация, от имени которой пост: страница компании или университета. */
export interface PostOrg {
  id: string
  name: string
  logoUrl: string | null
  href: string
  icon: LucideIcon
  mark: ReactNode
}

/**
 * Пост страницы организации говорит от её имени: карточка показывает компанию или вуз, а
 * автора — второй строкой. null — обычный пост человека.
 */
export function postOrg(post: Pick<FeedPost, 'company' | 'universityPage'>): PostOrg | null {
  if (post.company) {
    return {
      ...post.company,
      href: companyPath(post.company.id),
      icon: Building2,
      mark: <CompanyMark />,
    }
  }
  if (post.universityPage) {
    return {
      ...post.universityPage,
      href: universityPath(post.universityPage.id),
      icon: GraduationCap,
      mark: <UniversityMark />,
    }
  }
  return null
}
