'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import { FileText } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import {
  applicationKeys,
  fetchApplication,
  fetchApplications,
  uploadApplicationAttachment,
  withdrawApplicationRequest,
} from '../../../entities/application'
import { SubmitApplicationForm } from '../../../features/submit-application'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  FileUpload,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { AttachmentList, StatusBadge, StatusTimeline } from './application-parts'

export function StudentApplicationsView() {
  const t = useTranslations('Applications')
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const locale = useLocale()
  const qc = useQueryClient()
  const role = useAppSelector((s) => s.auth.role)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const list = useQuery({ queryKey: applicationKeys.list(), queryFn: () => fetchApplications() })
  const detail = useQuery({
    queryKey: applicationKeys.detail(selectedId ?? ''),
    queryFn: () => fetchApplication(selectedId as string),
    enabled: !!selectedId,
  })

  const withdraw = useMutation({
    mutationFn: (id: string) => withdrawApplicationRequest(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: applicationKeys.all })
      setSelectedId(null)
      toast.success(t('withdrawn'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const fmt = (iso: string): string =>
    new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>

      {role === Role.STUDENT && <SubmitApplicationForm onCreated={(id) => setSelectedId(id)} />}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Список */}
        <div className="flex flex-col gap-2">
          {list.isLoading ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : list.isError ? (
            <EmptyState title={tErr('INTERNAL_ERROR')} />
          ) : (list.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon={<FileText className="size-6" aria-hidden />}
              title={t('listEmpty')}
              description={t('listEmptyHint')}
            />
          ) : (
            list.data!.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelectedId(a.id)}
                className={cn(
                  'flex cursor-pointer flex-col gap-1 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-muted/50',
                  selectedId === a.id && 'border-primary/50 bg-primary/5',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{a.subject}</span>
                  <StatusBadge status={a.status} />
                </div>
                <span className="text-xs text-muted-foreground">
                  {t(`type${a.type}`)} · {fmt(a.createdAt)}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Детали */}
        <div>
          {!selectedId ? (
            <Card className="flex min-h-[200px] items-center justify-center">
              <p className="text-sm text-muted-foreground">{t('selectHint')}</p>
            </Card>
          ) : detail.isLoading || !detail.data ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="truncate">{detail.data.subject}</span>
                  <StatusBadge status={detail.data.status} />
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm whitespace-pre-wrap">{detail.data.body}</p>

                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">{t('attachments')}</h3>
                  <AttachmentList
                    applicationId={detail.data.id}
                    attachments={detail.data.attachments}
                  />
                  {(detail.data.status === 'NEW' || detail.data.status === 'CLARIFICATION') && (
                    <FileUpload
                      category="DOCUMENT"
                      uploadFn={(file, onProgress) =>
                        uploadApplicationAttachment(detail.data!.id, file, onProgress)
                      }
                      onUploaded={() => {
                        void qc.invalidateQueries({
                          queryKey: applicationKeys.detail(detail.data!.id),
                        })
                        toast.success(t('attachmentUploaded'))
                      }}
                      onError={(code) => toast.error(tErr(code))}
                    />
                  )}
                </section>

                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">{t('timeline')}</h3>
                  <StatusTimeline history={detail.data.history} />
                </section>

                {detail.data.status === 'NEW' && (
                  <Button
                    type="button"
                    variant="outline"
                    loading={withdraw.isPending}
                    onClick={() => {
                      void confirm({ title: t('withdrawConfirm'), destructive: true }).then(
                        (ok) => {
                          if (ok) withdraw.mutate(detail.data!.id)
                        },
                      )
                    }}
                    className="self-start text-destructive"
                  >
                    {t('withdraw')}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
