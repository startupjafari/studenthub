'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { companyKeys, fetchMyCompany } from '../../../entities/company'
import { CompanyProfile } from '../../../widgets/user-profile'
import { Button, EmptyState, PageLoader } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'

/**
 * Раздел «Компания» работодателя — страница его компании такой, какой её видят студенты:
 * профиль (поля правит владелец), посты, фото, видео, статьи и опросы от имени компании.
 */
export function EmployerCompanyView() {
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const company = useQuery({ queryKey: companyKeys.mine(), queryFn: fetchMyCompany })

  if (company.isError) {
    return (
      <EmptyState
        title={tErr(toApiError(company.error).code)}
        description={tErr('retryHint')}
        action={
          <Button variant="outline" onClick={() => void company.refetch()}>
            {tCommon('retry')}
          </Button>
        }
      />
    )
  }
  if (!company.data) return <PageLoader label={tCommon('loading')} />
  return <CompanyProfile companyId={company.data.id} />
}
