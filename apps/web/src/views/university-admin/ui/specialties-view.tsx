'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { GraduationCap, Plus, Trash2 } from 'lucide-react'
import { Button, Card, EmptyState, PageHeader, Skeleton, useConfirm } from '../../../shared/ui'
import {
  deleteSpecialtyRequest,
  fetchSpecialties,
  specialtyKeys,
} from '../../../entities/specialty'
import { CreateSpecialtyModal } from './create-specialty-modal'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

export function SpecialtiesAdminView() {
  const t = useTranslations('UniAdmin')
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const qc = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)

  const specialties = useQuery({ queryKey: specialtyKeys.list(), queryFn: fetchSpecialties })

  const deleteMut = useMutation({
    mutationFn: deleteSpecialtyRequest,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: specialtyKeys.list() })
      toast.success(t('specialtyDeleted'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('specialtiesTitle')}
        actions={
          <Button type="button" size="md" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t('addSpecialty')}
          </Button>
        }
      />

      {specialties.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : specialties.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : specialties.data && specialties.data.length > 0 ? (
        <div className="flex flex-col gap-2">
          {specialties.data.map((s) => (
            <Card key={s.id} className="flex-row items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <GraduationCap className="size-4" aria-hidden />
                </span>
                <span className="font-medium">{s.name}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon
                aria-label={t('delete')}
                loading={deleteMut.isPending && deleteMut.variables === s.id}
                onClick={() => {
                  void confirm({
                    title: t('deleteSpecialtyConfirm', { name: s.name }),
                    destructive: true,
                  }).then((ok) => {
                    if (ok) deleteMut.mutate(s.id)
                  })
                }}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<GraduationCap className="size-6" aria-hidden />}
          title={t('noSpecialties')}
          description={t('noSpecialtiesHint')}
          action={
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden />
              {t('addSpecialty')}
            </Button>
          }
        />
      )}

      {createOpen && <CreateSpecialtyModal onClose={() => setCreateOpen(false)} />}
    </div>
  )
}
