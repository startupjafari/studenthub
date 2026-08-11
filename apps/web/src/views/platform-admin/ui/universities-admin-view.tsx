'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Building2 } from 'lucide-react'
import {
  CreateUniversitySchema,
  type CreateUniversityInput,
  type UniversityStatusValue,
} from '@studenthub/shared-schemas'
import {
  createUniversityRequest,
  fetchUniversities,
  setUniversityStatusRequest,
  universityKeys,
  type University,
} from '../../../entities/university'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

const STATUSES: UniversityStatusValue[] = ['PENDING', 'ACTIVE', 'BLOCKED']
const STATUS_STYLE: Record<UniversityStatusValue, string> = {
  PENDING: 'text-amber-600 dark:text-amber-400',
  ACTIVE: 'text-emerald-600 dark:text-emerald-400',
  BLOCKED: 'text-destructive',
}

export function UniversitiesAdminView() {
  const t = useTranslations('Universities')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()

  const universities = useQuery({ queryKey: universityKeys.list(), queryFn: fetchUniversities })

  const form = useForm<CreateUniversityInput>({ resolver: zodResolver(CreateUniversitySchema) })

  const createMut = useMutation({
    mutationFn: (input: CreateUniversityInput) => createUniversityRequest(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: universityKeys.list() })
      form.reset({ name: '', shortName: '', city: '', country: '' })
      toast.success(t('created'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

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
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title={t('title')} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('add')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={form.handleSubmit((v) => createMut.mutate(v))}
            className="grid gap-3 sm:grid-cols-2"
          >
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="u-name">{t('name')}</Label>
              <Input id="u-name" {...form.register('name')} />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{t('required')}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="u-short">{t('shortName')}</Label>
              <Input id="u-short" {...form.register('shortName')} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="u-city">{t('city')}</Label>
              <Input id="u-city" {...form.register('city')} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" loading={createMut.isPending}>
                {t('add')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

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
                    {u.city && <span className="text-muted-foreground"> · {u.city}</span>}
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
