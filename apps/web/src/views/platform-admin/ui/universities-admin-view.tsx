'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Building2, Plus } from 'lucide-react'
import { type UniversityStatusValue } from '@studenthub/shared-schemas'
import {
  fetchUniversities,
  setUniversityStatusRequest,
  universityKeys,
  type University,
} from '../../../entities/university'
import { useKatoNames } from '../../../entities/kato'
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { CreateUniversityModal } from './create-university-modal'

const STATUSES: UniversityStatusValue[] = ['PENDING', 'ACTIVE', 'BLOCKED']
const STATUS_STYLE: Record<UniversityStatusValue, string> = {
  PENDING: 'text-warning',
  ACTIVE: 'text-success',
  BLOCKED: 'text-destructive',
}

export function UniversitiesAdminView() {
  const t = useTranslations('Universities')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)

  const universities = useQuery({ queryKey: universityKeys.list(), queryFn: fetchUniversities })

  // `city` хранит код КАТО. Резолвим весь список одним запросом — запрос на строку дал бы N+1.
  const { nameOf: cityName } = useKatoNames((universities.data ?? []).map((u) => u.city))

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: UniversityStatusValue }) =>
      setUniversityStatusRequest(id, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: universityKeys.list() })
      toast.success(t('statusChanged'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      {/* Создание — кнопка в шапке и модалка: постоянная форма наверху страницы
          отодвигала сам список вниз, хотя вуз добавляют редко. */}
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button size="md" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t('add')}
          </Button>
        }
      />

      {createOpen && <CreateUniversityModal onClose={() => setCreateOpen(false)} />}

      {universities.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : universities.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : (universities.data?.length ?? 0) === 0 ? (
        <EmptyState icon={<Building2 className="size-6" aria-hidden />} title={t('empty')} />
      ) : (
        <div className="flex flex-col gap-2">
          {universities.data!.map((u: University) => (
            <Card key={u.id} className="flex-row items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="size-4" aria-hidden />
                </span>
                <div>
                  <p className="font-medium">{u.name}</p>
                  <p className={cn('text-xs font-medium', STATUS_STYLE[u.status])}>
                    {t(`status${u.status}`)}
                    {cityName(u.city) && (
                      <span className="text-muted-foreground"> · {cityName(u.city)}</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="w-40">
                <Select
                  value={u.status}
                  onValueChange={(v) =>
                    statusMut.mutate({ id: u.id, status: v as UniversityStatusValue })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`status${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
