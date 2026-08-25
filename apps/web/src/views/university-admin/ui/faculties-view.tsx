'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Building2, Trash2 } from 'lucide-react'
import { CreateFacultySchema, type CreateFacultyInput } from '@studenthub/shared-schemas'
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
  createFacultyRequest,
  deleteFacultyRequest,
  facultyKeys,
  fetchFaculties,
} from '../../../entities/faculty'
import { fetchMe, userKeys } from '../../../entities/user'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

export function FacultiesAdminView() {
  const t = useTranslations('UniAdmin')
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const qc = useQueryClient()

  const me = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })
  const faculties = useQuery({ queryKey: facultyKeys.list(), queryFn: () => fetchFaculties() })

  const form = useForm<CreateFacultyInput>({ resolver: zodResolver(CreateFacultySchema) })
  useEffect(() => {
    if (me.data) form.setValue('universityId', me.data.universityId ?? '')
  }, [me.data, form])

  const createMut = useMutation({
    mutationFn: createFacultyRequest,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: facultyKeys.list() })
      form.reset({ name: '', universityId: me.data?.universityId ?? '' })
      toast.success(t('facultyCreated'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

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
    <div className="flex flex-col gap-6">
      <PageHeader title={t('facultiesTitle')} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('addFaculty')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={form.handleSubmit((v) => createMut.mutate(v))}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="fname">{t('facultyName')}</Label>
              <Input
                id="fname"
                placeholder={t('facultyNamePlaceholder')}
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
        />
      )}
    </div>
  )
}
