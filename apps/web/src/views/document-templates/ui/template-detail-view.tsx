'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Archive,
  Download,
  Eye,
  FileDown,
  Pencil,
  Send,
  Trash2,
  Undo2,
  Upload,
  UserRound,
} from 'lucide-react'
import type { DocumentTemplateDetail } from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { formatBytes, useByteUnitLabel } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  documentTemplateKeys,
  fetchDocumentTemplate,
  updateDocumentTemplate,
} from '../../../entities/document-template'
import { useTemplateActions } from '../lib/use-template-actions'
import { useTemplateTexts } from '../lib/use-template-texts'
import { GenerateForStudentModal } from './generate-for-student-modal'
import { StatusBadge } from './status-badge'
import { TemplateInfoForm } from './template-info-form'
import { TemplatePreviewModal } from './template-preview-modal'
import { TemplateUpload } from './template-upload'
import { ValidationReport } from './validation-report'
import { TEMPLATES_BASE } from './document-templates-view'

// Колонка карточек: на широком экране последняя тянется до низа сетки.
const COLUMN = 'flex flex-col gap-4 lg:[&>*:last-child]:flex-1'

type Dialog = 'edit' | 'upload' | 'generate' | 'preview' | null

interface TemplateDetailViewProps {
  templateId: string
}

// Карточка шаблона: рабочая версия и её проверка, история версий, публикация, документ для
// студента. Все действия доступны и с телефона — кнопки переносятся, таблиц здесь нет.
export function TemplateDetailView({ templateId }: TemplateDetailViewProps) {
  const t = useTranslations('DocumentTemplates')
  const tErr = useTranslations('Errors')
  const router = useRouter()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const format = useFormatter()
  const unit = useByteUnitLabel()
  const { errorToast } = useTemplateTexts()
  const [dialog, setDialog] = useState<Dialog>(null)
  const actions = useTemplateActions(templateId)

  const q = useQuery({
    queryKey: documentTemplateKeys.detail(templateId),
    queryFn: () => fetchDocumentTemplate(templateId),
  })

  const edit = useMutation({
    mutationFn: (input: Parameters<typeof updateDocumentTemplate>[1]) =>
      updateDocumentTemplate(templateId, input),
    onSuccess: (detail) => {
      qc.setQueryData(documentTemplateKeys.detail(templateId), detail)
      void qc.invalidateQueries({ queryKey: documentTemplateKeys.all })
      toast.success(t('savedToast'))
      setDialog(null)
    },
    onError: (e) => toast.error(errorToast(e)),
  })

  const back = () => router.push(TEMPLATES_BASE)

  // Шапка — во всех состояниях, как на остальных вложенных страницах: пока карточка
  // грузится или не открылась, «назад» уже на месте и экран не прыгает.
  if (q.isPending || q.isError) {
    const code = q.isError ? ((q.error as { code?: string }).code ?? 'INTERNAL_ERROR') : null
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        <PageHeader title={t('title')} onBack={back} backLabel={t('backToList')} />
        {code === null ? (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        ) : (
          <EmptyState
            title={tErr(code)}
            action={
              code === 'NOT_FOUND' || code === 'WRONG_SCOPE' ? (
                <Button onClick={back}>{t('backToList')}</Button>
              ) : (
                <Button onClick={() => void q.refetch()}>{t('retry')}</Button>
              )
            }
          />
        )}
      </div>
    )
  }

  const tpl: DocumentTemplateDetail = q.data
  const archived = tpl.status === 'ARCHIVED'
  const current = tpl.versions.find((v) => v.id === tpl.currentVersion?.id) ?? null
  const valid = current?.validation.valid === true
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'short', year: 'numeric' })

  const remove = async () => {
    const ok = await confirm({
      title: t('deleteConfirm', { title: tpl.title }),
      description: tpl.generationCount > 0 ? t('deleteArchivesHint') : t('deleteHint'),
      confirmLabel: tpl.generationCount > 0 ? t('archive') : t('delete'),
      destructive: true,
    })
    if (ok)
      actions.remove.mutate(undefined, {
        onSuccess: ({ archived: a }) => (a ? void q.refetch() : back()),
      })
  }

  const unpublish = async () => {
    const ok = await confirm({
      title: t('unpublishConfirm'),
      description: t('unpublishHint'),
      confirmLabel: t('unpublish'),
    })
    if (ok) actions.unpublish.mutate()
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      {/* Подзаголовок — строкой текста: бейдж в нём делал полосу шапки выше, чем на соседних
          страницах. Статус — в карточке «О шаблоне», она есть и у архивного. */}
      <PageHeader
        title={tpl.title}
        subtitle={`${t(`category_${tpl.category}`)} · ${t(`locale_${tpl.locale}`)}`}
        onBack={back}
        backLabel={t('backToList')}
        actions={
          !archived && (
            <>
              <Button variant="outline" size="md" onClick={() => setDialog('edit')}>
                <Pencil className="size-4" aria-hidden /> {t('edit')}
              </Button>
              <Button
                variant="outline"
                size="md"
                className="text-destructive"
                loading={actions.remove.isPending}
                onClick={() => void remove()}
              >
                <Trash2 className="size-4" aria-hidden /> {t('delete')}
              </Button>
            </>
          )
        }
      />

      {archived && (
        <Card className="flex flex-row items-start gap-3 border-warning/30 bg-warning/5 p-4 text-sm">
          <Archive className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <p>{t('archivedNotice', { count: tpl.generationCount })}</p>
        </Card>
      )}

      {/* Две колонки на всю высоту под шапкой и с общим нижним краем. Тянется последняя
          карточка каждой колонки (COLUMN), какой бы она ни была: новый блок, добавленный в
          конец, сам становится растягиваемым, а прежний возвращается к своей высоте. Сетка
          задаёт минимум, а не потолок — если содержимое выше экрана, прокручивается страница.
          Обе колонки — одинаковые карточки (p-4, заголовок text-base): с разными отступами
          заголовки левой и правой колонок стояли на разной высоте. */}
      <div className="grid items-start gap-4 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-stretch">
        <div className={cn('min-w-0', COLUMN)}>
          <Card className="flex flex-col gap-4 p-4">
            {/* «Заменить файл» — в строке заголовка: тремя кнопками внизу ряд не помещался и
                переносился лесенкой. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">
                  {current ? t('currentVersion', { version: current.version }) : t('fileTitle')}
                </h2>
                {tpl.hasUnpublishedChanges && (
                  <Badge variant="info">{t('unpublishedChanges')}</Badge>
                )}
              </div>
              {current && !archived && (
                <Button variant="outline" size="sm" onClick={() => setDialog('upload')}>
                  <Upload className="size-4" aria-hidden /> {t('replaceFile')}
                </Button>
              )}
            </div>

            {!current ? (
              archived ? (
                <p className="text-sm text-muted-foreground">{t('noFileYet')}</p>
              ) : (
                <div className="flex flex-1 flex-col gap-3">
                  <p className="text-sm text-muted-foreground">{t('uploadIntro')}</p>
                  <TemplateUpload
                    templateId={templateId}
                    onUploaded={() => undefined}
                    className="flex-1"
                  />
                </div>
              )
            ) : (
              <>
                <ValidationReport validation={current.validation} />
                <div className="grid gap-2 sm:flex sm:flex-wrap">
                  <Button variant="outline" disabled={!valid} onClick={() => setDialog('preview')}>
                    <Eye className="size-4" aria-hidden /> {t('previewButton')}
                  </Button>
                  <Button
                    variant="outline"
                    loading={actions.source.isPending}
                    onClick={() => actions.source.mutate(current.id)}
                  >
                    <Download className="size-4" aria-hidden /> {t('downloadSource')}
                  </Button>
                </div>
              </>
            )}
          </Card>

          {tpl.versions.length > 0 && (
            <Card className="flex flex-col gap-3 p-4">
              <h2 className="text-base font-semibold">{t('versionsTitle')}</h2>
              <ul className="flex flex-col divide-y">
                {tpl.versions.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        {t('versionN', { version: v.version })}
                        {v.id === tpl.publishedVersion?.id && (
                          <Badge variant="success">{t('publishedBadge')}</Badge>
                        )}
                        {!v.validation.valid && (
                          <Badge variant="destructive">{t('needsFix')}</Badge>
                        )}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[
                          v.fileName,
                          formatBytes(v.size, unit),
                          date(v.createdAt),
                          v.createdBy?.name,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon
                      aria-label={t('downloadVersion', { version: v.version })}
                      title={t('downloadVersion', { version: v.version })}
                      onClick={() => actions.source.mutate(v.id)}
                    >
                      <FileDown className="size-4" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className={COLUMN}>
          {!archived && (
            <Card className="flex flex-col gap-3 p-4">
              <h2 className="text-base font-semibold">{t('publicationTitle')}</h2>
              <p className="text-sm text-muted-foreground">
                {tpl.status === 'PUBLISHED' && tpl.publishedVersion
                  ? t('publishedInfo', {
                      version: tpl.publishedVersion.version,
                      date: tpl.publishedAt ? date(tpl.publishedAt) : '',
                    })
                  : valid
                    ? t('publishReady')
                    : t('publishBlocked')}
              </p>
              {(tpl.status !== 'PUBLISHED' || tpl.hasUnpublishedChanges) && (
                <Button
                  disabled={!valid}
                  loading={actions.publish.isPending}
                  onClick={() => actions.publish.mutate()}
                >
                  <Send className="size-4" aria-hidden />
                  {tpl.hasUnpublishedChanges ? t('publishChanges') : t('publish')}
                </Button>
              )}
              {tpl.status === 'PUBLISHED' && (
                <Button
                  variant="outline"
                  loading={actions.unpublish.isPending}
                  onClick={() => void unpublish()}
                >
                  <Undo2 className="size-4" aria-hidden /> {t('unpublish')}
                </Button>
              )}
            </Card>
          )}

          {tpl.status === 'PUBLISHED' && (
            <Card className="flex flex-col gap-3 p-4">
              <h2 className="text-base font-semibold">{t('generateTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('generateHint')}</p>
              <Button variant="outline" onClick={() => setDialog('generate')}>
                <UserRound className="size-4" aria-hidden /> {t('generateButton')}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t('generationCount', { count: tpl.generationCount })}
              </p>
            </Card>
          )}

          <Card className="flex flex-col gap-3 p-4 text-sm">
            <h2 className="text-base font-semibold">{t('aboutTitle')}</h2>
            {tpl.description && <p className="text-muted-foreground">{tpl.description}</p>}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">{t('colStatus')}</dt>
              <dd>
                <StatusBadge status={tpl.status} />
              </dd>
              <dt className="text-muted-foreground">{t('colAuthor')}</dt>
              <dd className="truncate">{tpl.author?.name ?? '—'}</dd>
              <dt className="text-muted-foreground">{t('colCreated')}</dt>
              <dd>{date(tpl.createdAt)}</dd>
              <dt className="text-muted-foreground">{t('colUpdated')}</dt>
              <dd>{date(tpl.updatedAt)}</dd>
              <dt className="text-muted-foreground">{t('colVariables')}</dt>
              <dd>{tpl.variableCount}</dd>
            </dl>
          </Card>
        </div>
      </div>

      {dialog === 'edit' && (
        <Modal onClose={() => setDialog(null)} title={t('editTitle')} size="lg">
          <TemplateInfoForm
            defaultValues={{
              title: tpl.title,
              category: tpl.category,
              description: tpl.description ?? '',
              locale: tpl.locale,
            }}
            submitLabel={t('save')}
            pending={edit.isPending}
            onSubmit={(values) =>
              edit.mutate({ ...values, description: values.description || null })
            }
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog === 'upload' && (
        <Modal onClose={() => setDialog(null)} title={t('replaceFile')} size="lg">
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">{t('replaceHint')}</p>
            <TemplateUpload templateId={templateId} onUploaded={() => setDialog(null)} />
          </div>
        </Modal>
      )}

      {dialog === 'preview' && current && (
        <TemplatePreviewModal
          templateId={templateId}
          versionId={current.id}
          version={current.version}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'generate' && (
        <GenerateForStudentModal
          pending={actions.generate.isPending}
          onClose={() => setDialog(null)}
          onGenerate={(studentId) => actions.generate.mutate(studentId)}
        />
      )}
    </div>
  )
}
