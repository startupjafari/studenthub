'use client'

import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { GraduationCap, MapPin } from 'lucide-react'
import {
  fetchUniversityPage,
  removeUniversityImage,
  universityKeys,
  uploadUniversityImage,
} from '../../../entities/university'
import { useKatoNames } from '../../../entities/kato'
import { Badge } from '../../../shared/ui'
import { OrgBody, OrgProfile } from './org-profile'
import { UniversityEditForm, UNIVERSITY_EDIT_FORM_ID } from './university-edit-form'

interface UniversityProfileProps {
  universityId: string
  /** На обложке — переключатель «Мой профиль / Университет» у админа и модератора вуза. */
  toolbar?: ReactNode
}

/**
 * Страница университета: витрина вуза и контент от его имени. Публикуют админ и модератор
 * своего вуза; страницу (описание, контакты, логотип, обложку) правит админ. Видят свои,
 * платформа и компании с допуском. Название и город — реквизиты вуза, их правит платформа.
 */
export function UniversityProfile({ universityId, toolbar }: UniversityProfileProps) {
  const t = useTranslations('University')
  const qc = useQueryClient()

  const page = useQuery({
    queryKey: universityKeys.page(universityId),
    queryFn: () => fetchUniversityPage(universityId),
  })
  const university = page.data
  // Город вуза — код КАТО (или свободный текст у зарубежного): показываем название.
  const { nameOf: cityName } = useKatoNames([university?.city])
  const city = cityName(university?.city)

  return (
    <OrgProfile
      owner={{ kind: 'university', id: universityId }}
      toolbar={toolbar}
      header={
        university && {
          name: university.name,
          logoUrl: university.logoUrl,
          coverUrl: university.coverUrl,
          icon: GraduationCap,
          badge: (
            <Badge variant="default">
              <GraduationCap className="size-3" aria-hidden />
              {t('pageBadge')}
            </Badge>
          ),
          metas: [
            ...(university.shortName ? [{ icon: GraduationCap, label: university.shortName }] : []),
            ...(city ? [{ icon: MapPin, label: city }] : []),
          ],
        }
      }
      error={page.error ?? undefined}
      onRetry={() => void page.refetch()}
      notFound={{ title: t('notFound'), hint: t('notFoundHint') }}
      canPublish={!!university?.canPublish}
      canEdit={!!university?.canEdit}
      images={{
        upload: uploadUniversityImage,
        remove: removeUniversityImage,
        onChanged: () => void qc.invalidateQueries({ queryKey: universityKeys.page(universityId) }),
      }}
      visibilityHint={t('visibilityHint')}
      body={
        university && (
          <OrgBody
            page={university}
            aboutTitle={t('about')}
            details={[
              { icon: GraduationCap, label: t('fieldShortName'), value: university.shortName },
              { icon: MapPin, label: t('fieldCity'), value: city },
            ]}
          />
        )
      }
      editForm={(onSaved) =>
        university && <UniversityEditForm university={university} onSaved={onSaved} />
      }
      editFormId={UNIVERSITY_EDIT_FORM_ID}
    />
  )
}
