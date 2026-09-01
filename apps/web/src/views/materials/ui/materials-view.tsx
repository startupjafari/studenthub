'use client'

import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Download, FileText, FolderOpen, Link2, Trash2 } from 'lucide-react'
import { CreateMaterialSchema, type CreateMaterialInput } from '@studenthub/shared-schemas'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import { OPTIONAL_TEXT } from '../../../shared/lib'
import {
  createMaterialRequest,
  deleteMaterialRequest,
  fetchMaterialFileUrl,
  fetchMaterials,
  materialKeys,
  uploadMaterialFileRequest,
  type Material,
} from '../../../entities/material'
import { fetchGroups, groupKeys } from '../../../entities/group'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  FileUpload,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'

const AUTHOR_ROLES: Role[] = [Role.TEACHER, Role.DEAN, Role.UNIVERSITY_ADMIN, Role.PLATFORM_ADMIN]

export function MaterialsView() {
  const t = useTranslations('Materials')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const role = useAppSelector((s) => s.auth.role)
  const canCreate = role !== null && AUTHOR_ROLES.includes(role)

  const materials = useQuery({ queryKey: materialKeys.list(), queryFn: () => fetchMaterials() })
  const groups = useQuery({
    queryKey: groupKeys.list(),
    queryFn: () => fetchGroups(),
    enabled: canCreate,
  })

  const form = useForm<CreateMaterialInput>({ resolver: zodResolver(CreateMaterialSchema) })

  const createMut = useMutation({
    mutationFn: (input: CreateMaterialInput) =>
      createMaterialRequest({ ...input, url: input.url || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: materialKeys.all })
      form.reset({
        groupId: form.getValues('groupId'),
        title: '',
        description: '',
        subject: '',
        url: '',
      })
      toast.success(t('created'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  // Без `min-h-0`: экран прокручивается целиком, внутреннего скролл-контейнера тут нет.
  // С `min-h-0` колонка ужималась до высоты `main`, а карточки с `overflow-hidden`
  // резали содержимое — оно уходило за нижнюю границу без всякой прокрутки.
  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} />

      {canCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('add')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={form.handleSubmit((v) => createMut.mutate(v))}
              className="grid gap-3 sm:grid-cols-2"
            >
              <div className="flex flex-col gap-2">
                <Label>{t('group')}</Label>
                <Controller
                  control={form.control}
                  name="groupId"
                  render={({ field }) => (
                    <Select value={field.value ?? ''} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('selectGroup')} />
                      </SelectTrigger>
                      <SelectContent>
                        {(groups.data ?? []).map((g) => (
                          <SelectItem key={g.id} value={g.id}>
                            {g.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {form.formState.errors.groupId && (
                  <p className="text-xs text-destructive">{t('required')}</p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="m-subject">{t('subject')}</Label>
                <Input id="m-subject" {...form.register('subject', OPTIONAL_TEXT)} />
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="m-title">{t('materialTitle')}</Label>
                <Input id="m-title" {...form.register('title')} />
                {form.formState.errors.title && (
                  <p className="text-xs text-destructive">{t('required')}</p>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="m-desc">{t('description')}</Label>
                <Input id="m-desc" {...form.register('description')} />
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="m-url">{t('url')}</Label>
                <Input
                  id="m-url"
                  {...form.register('url', OPTIONAL_TEXT)}
                  placeholder="https://…"
                />
                {form.formState.errors.url && (
                  <p className="text-xs text-destructive">{t('urlInvalid')}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" loading={createMut.isPending}>
                  {t('add')}
                </Button>
              </div>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">{t('fileHint')}</p>
          </CardContent>
        </Card>
      )}

      {materials.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : materials.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : (materials.data?.length ?? 0) === 0 ? (
        <EmptyState icon={<FolderOpen className="size-6" aria-hidden />} title={t('empty')} />
      ) : (
        <div className="flex flex-col gap-3">
          {materials.data!.map((m) => (
            <MaterialCard key={m.id} material={m} canManage={canCreate} />
          ))}
        </div>
      )}
    </div>
  )
}

function MaterialCard({ material, canManage }: { material: Material; canManage: boolean }) {
  const t = useTranslations('Materials')
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [downloading, setDownloading] = useState<string | null>(null)

  const deleteMut = useMutation({
    mutationFn: () => deleteMaterialRequest(material.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: materialKeys.all })
      toast.success(t('deleted'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  async function download(fileId: string): Promise<void> {
    setDownloading(fileId)
    try {
      const url = await fetchMaterialFileUrl(material.id, fileId)
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
    } finally {
      setDownloading(null)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold">{material.title}</h3>
            {material.subject && (
              <p className="text-xs text-muted-foreground">{material.subject}</p>
            )}
            {material.description && <p className="mt-1 text-sm">{material.description}</p>}
          </div>
          {canManage && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon
              aria-label={t('delete')}
              loading={deleteMut.isPending}
              onClick={() => {
                void confirm({ title: t('deleteConfirm'), destructive: true }).then((ok) => {
                  if (ok) deleteMut.mutate()
                })
              }}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          )}
        </div>

        {material.url && (
          <a
            href={material.url}
            target="_blank"
            rel="noopener noreferrer"
            // Отступы поднимают цель нажатия с 20px до 28px — минимум WCAG 2.5.8 24×24.
            className="-my-1 flex w-fit items-center gap-1.5 py-1 text-sm text-primary hover:underline"
          >
            <Link2 className="size-4" aria-hidden />
            {t('openLink')}
          </a>
        )}

        {material.media.length > 0 && (
          <ul className="flex flex-col gap-2">
            {material.media.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{f.mime}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {(f.size / 1024).toFixed(0)} КБ
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => download(f.id)}
                  disabled={downloading === f.id}
                  aria-label={t('download')}
                  className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <Download className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <FileUpload
            category="DOCUMENT"
            uploadFn={(file, onProgress) =>
              uploadMaterialFileRequest(material.id, file, onProgress)
            }
            onUploaded={() => {
              void qc.invalidateQueries({ queryKey: materialKeys.all })
              toast.success(t('fileAdded'))
            }}
            onError={(code) => toast.error(tErr(code))}
          />
        )}
      </CardContent>
    </Card>
  )
}
