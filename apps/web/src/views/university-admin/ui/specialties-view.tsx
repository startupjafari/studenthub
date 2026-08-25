'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { GraduationCap, Trash2 } from 'lucide-react'
import { CreateSpecialtySchema, type CreateSpecialtyInput } from '@studenthub/shared-schemas'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import {
  createSpecialtyRequest,
  deleteSpecialtyRequest,
  fetchSpecialties,
  specialtyKeys,
} from '../../../entities/specialty'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

export function SpecialtiesAdminView() {
  const t = useTranslations('UniAdmin')
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const qc = useQueryClient()

  const specialties = useQuery({ queryKey: specialtyKeys.list(), queryFn: fetchSpecialties })
  const form = useForm<CreateSpecialtyInput>({ resolver: zodResolver(CreateSpecialtySchema) })

  const createMut = useMutation({
    mutationFn: createSpecialtyRequest,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: specialtyKeys.list() })
      form.reset({ name: '' })
      toast.success(t('specialtyCreated'))
    },
    onError: (e) => {
      const code = errCode(e)
      toast.error(code === 'CONFLICT' ? t('specialtyExists') : tErr(code))
    },
  })

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
      <PageHeader title={t('specialtiesTitle')} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('addSpecialty')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={form.handleSubmit((v) => createMut.mutate(v))}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="sname">{t('specialtyName')}</Label>
              <Input
                id="sname"
                placeholder={t('specialtyNamePlaceholder')}
                {...form.register('name')}
              />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{t('nameRequired')}</p>
              )}
            </div>
            <Button type="submit" loading={createMut.isPending}>
              {t('add')}
            </Button>
          </form>
        </CardContent>
      </Card>

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
        />
      )}
    </div>
  )
}
