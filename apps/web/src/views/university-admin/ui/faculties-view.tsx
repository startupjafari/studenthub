'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Building2, Plus, Trash2 } from 'lucide-react'
import { Button, Card, EmptyState, PageHeader, Skeleton, useConfirm } from '../../../shared/ui'
import { deleteFacultyRequest, facultyKeys, fetchFaculties } from '../../../entities/faculty'
import { CreateFacultyModal } from './create-faculty-modal'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

export function FacultiesAdminView() {
  const t = useTranslations('UniAdmin')
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const qc = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)

  const faculties = useQuery({ queryKey: facultyKeys.list(), queryFn: () => fetchFaculties() })

  const deleteMut = useMutation({
    mutationFn: deleteFacultyRequest,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: facultyKeys.list() })
      toast.success(t('facultyDeleted'))
    },
    onError: (e) => {
      const code = errCode(e)
      toast.error(code === 'CONFLICT' ? t('facultyHasGroups') : tErr(code))
    },
  })

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('facultiesTitle')}
        actions={
          <Button type="button" size="md" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t('addFaculty')}
          </Button>
        }
      />

      {faculties.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : faculties.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : faculties.data && faculties.data.length > 0 ? (
        <div className="flex flex-col gap-2">
          {faculties.data.map((f) => (
            <Card key={f.id} className="flex-row items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="size-4" aria-hidden />
                </span>
                <span className="font-medium">{f.name}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon
                aria-label={t('delete')}
                loading={deleteMut.isPending && deleteMut.variables === f.id}
                onClick={() => {
                  void confirm({
                    title: t('deleteFacultyConfirm', { name: f.name }),
                    destructive: true,
                  }).then((ok) => {
                    if (ok) deleteMut.mutate(f.id)
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
          icon={<Building2 className="size-6" aria-hidden />}
          title={t('noFaculties')}
          description={t('noFacultiesHint')}
          action={
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden />
              {t('addFaculty')}
            </Button>
          }
        />
      )}

      {createOpen && <CreateFacultyModal onClose={() => setCreateOpen(false)} />}
    </div>
  )
}
