'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, Clock, Search, ShieldX, Undo2 } from 'lucide-react'
import type { CompanyAccessStatus } from '@studenthub/shared-schemas'
import {
  companyKeys,
  fetchCompanyUniversityOptions,
  requestCompanyAccess,
  type CompanyUniversityOption,
} from '../../../entities/company'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'

/**
 * Заявки в вузы. Доступ к студентам открывает университет — здесь компания видит,
 * где он уже открыт, где заявка на рассмотрении и где было отказано (с причиной).
 */
export function EmployerAccessView() {
  const t = useTranslations('Employer')
  const tErr = useTranslations('Errors')
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [openFor, setOpenFor] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const options = useQuery({
    queryKey: companyKeys.universityOptions(search),
    queryFn: () => fetchCompanyUniversityOptions(search || undefined),
  })

  const request = useMutation({
    mutationFn: (universityId: string) =>
      requestCompanyAccess({ universityId, message: message || undefined }),
    onSuccess: async () => {
      setOpenFor(null)
      setMessage('')
      toast.success(t('requestSent'))
      await queryClient.invalidateQueries({ queryKey: companyKeys.all })
    },
    onError: (error) => toast.error(toApiError(error).message),
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader title={t('accessTitle')} subtitle={t('accessSubtitle')} />

      <div className="relative max-w-md">
        <Search
          className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchUniversity')}
          aria-label={t('searchUniversity')}
          className="pl-9"
        />
      </div>

      {options.isLoading ? (
        <ul className="flex flex-col gap-2" aria-busy>
          {['62%', '48%', '55%'].map((w) => (
            <li key={w} className="rounded-xl border border-border p-4">
              <Skeleton className="h-4 rounded-md" style={{ width: w }} />
            </li>
          ))}
        </ul>
      ) : options.isError ? (
        // Ошибку показываем именно ошибкой: 403 или обрыв сети, отрисованные как
        // «пусто», выглядят как «данных нет» и прячут настоящую причину.
        <EmptyState title={tErr('INTERNAL_ERROR')} description={tErr('retryHint')} />
      ) : (options.data?.length ?? 0) === 0 ? (
        <EmptyState title={t('noUniversities')} description={t('noUniversitiesHint')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {options.data?.map((u) => (
            <li
              key={u.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="font-semibold">{u.name}</p>
                  {u.city && <p className="text-sm text-muted-foreground">{u.city}</p>}
                  {u.access?.reason && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('decisionReason')}: {u.access.reason}
                    </p>
                  )}
                </div>
                <AccessAction
                  option={u}
                  pending={request.isPending && openFor === u.id}
                  onRequest={() => setOpenFor(u.id)}
                />
              </div>

              {openFor === u.id && (
                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  <Textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    placeholder={t('requestMessagePlaceholder')}
                    aria-label={t('requestMessage')}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      loading={request.isPending}
                      onClick={() => request.mutate(u.id)}
                    >
                      {t('sendRequest')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setOpenFor(null)}>
                      {t('cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Правая часть строки: либо статус, либо кнопка подачи заявки. */
function AccessAction({
  option,
  pending,
  onRequest,
}: {
  option: CompanyUniversityOption
  pending: boolean
  onRequest: () => void
}) {
  const t = useTranslations('Employer')
  const status = option.access?.status

  if (status === 'APPROVED') {
    return (
      <Badge variant="secondary" className="shrink-0 gap-1">
        <Check className="size-3.5" aria-hidden />
        {t('statusApproved')}
      </Badge>
    )
  }
  if (status === 'REQUESTED') {
    return (
      <Badge variant="outline" className="shrink-0 gap-1">
        <Clock className="size-3.5" aria-hidden />
        {t('statusRequested')}
      </Badge>
    )
  }

  // Отказ и отзыв различаем: после отзыва компания знала доступ и потеряла его, после
  // отказа — не получала. Кнопка повторной заявки есть в обоих случаях.
  const label: Record<Exclude<CompanyAccessStatus, 'APPROVED' | 'REQUESTED'>, string> = {
    REJECTED: t('statusRejected'),
    REVOKED: t('statusRevoked'),
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {status && (
        <Badge variant="outline" className="gap-1">
          {status === 'REVOKED' ? (
            <Undo2 className="size-3.5" aria-hidden />
          ) : (
            <ShieldX className="size-3.5" aria-hidden />
          )}
          {label[status]}
        </Badge>
      )}
      <Button size="sm" variant="outline" onClick={onRequest} disabled={pending}>
        {status ? t('requestAgain') : t('requestAccess')}
      </Button>
    </div>
  )
}
