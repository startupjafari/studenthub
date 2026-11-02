'use client'

import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Building2, Factory, MapPin, Users } from 'lucide-react'
import {
  companyKeys,
  fetchCompanyPage,
  fetchMyCompany,
  isCompanyOwner,
  removeCompanyImage,
  uploadCompanyImage,
} from '../../../entities/company'
import { useKatoNames } from '../../../entities/kato'
import { Badge } from '../../../shared/ui'
import { CompanyEditForm, COMPANY_EDIT_FORM_ID } from './company-edit-form'
import { OrgBody, OrgProfile } from './org-profile'
import { useCompanySizeLabel } from './company-size-label'

interface CompanyProfileProps {
  companyId: string
  /** На обложке — например, переключатель «Мой профиль / Компания» у работодателя. */
  toolbar?: ReactNode
}

/**
 * Страница компании: витрина и контент от её имени. Публикует любой сотрудник; профиль
 * компании (поля, логотип, обложку) правит только владелец. Остальные (вузы с допуском) —
 * читают.
 */
export function CompanyProfile({ companyId, toolbar }: CompanyProfileProps) {
  const t = useTranslations('Company')
  const qc = useQueryClient()
  const sizeLabel = useCompanySizeLabel()

  const page = useQuery({
    queryKey: companyKeys.page(companyId),
    queryFn: () => fetchCompanyPage(companyId),
  })
  const company = page.data
  const isMember = !!company?.isMember
  // Роль в компании — только у своей: правка профиля доступна владельцу.
  const mine = useQuery({
    queryKey: companyKeys.mine(),
    queryFn: fetchMyCompany,
    enabled: isMember,
  })
  const canEdit = isMember && isCompanyOwner(mine.data)
  // Город — код КАТО или свободный текст (зарубежная компания).
  const { nameOf: cityName } = useKatoNames([company?.city])
  const city = cityName(company?.city)

  return (
    <OrgProfile
      owner={{ kind: 'company', id: companyId }}
      toolbar={toolbar}
      header={
        company && {
          name: company.name,
          logoUrl: company.logoUrl,
          coverUrl: company.coverUrl,
          icon: Building2,
          badge: (
            <Badge variant="info">
              <Building2 className="size-3" aria-hidden />
              {t('pageBadge')}
            </Badge>
          ),
          metas: [
            ...(company.industry ? [{ icon: Factory, label: company.industry }] : []),
            ...(city ? [{ icon: MapPin, label: city }] : []),
            ...(company.size ? [{ icon: Users, label: sizeLabel(company.size) }] : []),
          ],
        }
      }
      error={page.error ?? undefined}
      onRetry={() => void page.refetch()}
      notFound={{ title: t('notFound'), hint: t('notFoundHint') }}
      canPublish={isMember}
      canEdit={canEdit}
      images={{
        upload: uploadCompanyImage,
        remove: removeCompanyImage,
        onChanged: () => {
          void qc.invalidateQueries({ queryKey: companyKeys.page(companyId) })
          void qc.invalidateQueries({ queryKey: companyKeys.mine() })
        },
      }}
      visibilityHint={t('visibilityHint')}
      body={
        company && (
          <OrgBody
            page={company}
            aboutTitle={t('about')}
            details={[
              { icon: Factory, label: t('fieldIndustry'), value: company.industry },
              {
                icon: Users,
                label: t('fieldSize'),
                value: company.size ? sizeLabel(company.size) : null,
              },
              { icon: MapPin, label: t('fieldCity'), value: city },
            ]}
          />
        )
      }
      editForm={(onSaved) => mine.data && <CompanyEditForm company={mine.data} onSaved={onSaved} />}
      editFormId={COMPANY_EDIT_FORM_ID}
    />
  )
}
