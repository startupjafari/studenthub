'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, Copy, Download, Globe, Lock } from 'lucide-react'
import {
  downloadResumePdf,
  fetchResumeSettings,
  resumeKeys,
  updateResume,
} from '../../../entities/resume'
import { Button, Checkbox, Input, Label, PageHeader, PageLoader } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

/**
 * Резюме студента.
 *
 * Содержимое не редактируется здесь: резюме собирается из карьерного профиля и портфолио
 * при каждой выдаче. Так «обновить резюме» — это обновить профиль, и оно не устаревает
 * молча. На экране остаются только решения: показывать ли по ссылке и включать ли контакты.
 */
export function CareerResumeView() {
  const t = useTranslations('Resume')
  const tCommon = useTranslations('Common')
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)

  const settings = useQuery({ queryKey: resumeKeys.mine(), queryFn: fetchResumeSettings })

  const save = useMutation({
    mutationFn: updateResume,
    onSuccess: (updated) => queryClient.setQueryData(resumeKeys.mine(), updated),
    onError: (error) => toast.error(toApiError(error).message),
  })

  const download = useMutation({
    mutationFn: () =>
      downloadResumePdf({
        about: t('sectionAbout'),
        education: t('sectionEducation'),
        skills: t('sectionSkills'),
        languages: t('sectionLanguages'),
        experience: t('sectionExperience'),
        projects: t('sectionProjects'),
        certificates: t('sectionCertificates'),
        verified: t('verified'),
        generated: t('generated'),
      }),
    onSuccess: (blob) => {
      // Сохранение файла из памяти: эндпоинт требует токен, прямой ссылкой не обойтись.
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'resume.pdf'
      link.click()
      URL.revokeObjectURL(url)
    },
    onError: (error) => toast.error(toApiError(error).message),
  })

  if (settings.isLoading || !settings.data) return <PageLoader label={tCommon('loading')} />

  const data = settings.data
  const publicUrl =
    data.publicSlug && typeof window !== 'undefined'
      ? `${window.location.origin}/r/resume/${data.publicSlug}`
      : null

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="resumeTitle">{t('titleField')}</Label>
          <Input
            id="resumeTitle"
            defaultValue={data.title}
            onBlur={(e) => {
              if (e.target.value !== data.title) save.mutate({ title: e.target.value })
            }}
            className="max-w-md"
          />
        </div>

        <Button
          className="self-start"
          loading={download.isPending}
          onClick={() => download.mutate()}
        >
          <Download className="size-4" aria-hidden />
          {t('downloadPdf')}
        </Button>
      </section>

      <section
        className={cn(
          'flex flex-col gap-3 rounded-xl border p-4',
          data.published ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 shrink-0 text-muted-foreground">
              {data.published ? (
                <Globe className="size-5" aria-hidden />
              ) : (
                <Lock className="size-5" aria-hidden />
              )}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-sm font-semibold">
                {data.published ? t('publicTitle') : t('privateTitle')}
              </p>
              <p className="text-sm text-muted-foreground">
                {data.published ? t('publicText') : t('privateText')}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant={data.published ? 'outline' : 'default'}
            loading={save.isPending}
            onClick={() => save.mutate({ published: !data.published })}
          >
            {data.published ? t('unpublish') : t('publish')}
          </Button>
        </div>

        {publicUrl && (
          <div className="flex flex-wrap items-center gap-2">
            <Input readOnly value={publicUrl} className="max-w-md font-mono text-xs" />
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(publicUrl)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <Copy className="size-4" aria-hidden />
              )}
              {copied ? t('copied') : t('copyLink')}
            </Button>
          </div>
        )}

        {data.published && (
          <div className="flex items-start gap-3 border-t border-border pt-3">
            <Checkbox
              id="includeContacts"
              checked={data.includeContacts}
              onCheckedChange={(checked) => save.mutate({ includeContacts: checked === true })}
            />
            <Label htmlFor="includeContacts" className="cursor-pointer font-normal">
              <span className="block">{t('includeContacts')}</span>
              <span className="block text-xs text-muted-foreground">
                {t('includeContactsHint')}
              </span>
            </Label>
          </div>
        )}
      </section>

      <p className="text-sm text-muted-foreground">{t('sourceHint')}</p>
    </div>
  )
}
