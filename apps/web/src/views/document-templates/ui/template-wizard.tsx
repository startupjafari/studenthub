'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArrowRight, Download, ListChecks } from 'lucide-react'
import type { DocumentTemplateDetail } from '@studenthub/shared-schemas'
import { Button, Modal, Stepper } from '../../../shared/ui'
import { createDocumentTemplate, documentTemplateKeys } from '../../../entities/document-template'
import { useTemplateActions } from '../lib/use-template-actions'
import { asTag, useTemplateTexts } from '../lib/use-template-texts'
import { TemplateInfoForm } from './template-info-form'
import { TemplateUpload } from './template-upload'
import { ValidationReport } from './validation-report'
import { VariableCatalog } from './variable-catalog'

const STEPS = ['info', 'prepare', 'upload', 'check', 'test', 'publish'] as const

interface TemplateWizardProps {
  /** Закрыть; `templateId` — если шаблон уже создан (черновиком или опубликованным). */
  onClose: (templateId?: string) => void
}

// Мастер создания шаблона: название → подготовка документа в Word → загрузка → проверка →
// пример → публикация. Шаблон создаётся черновиком на первом шаге, поэтому закрыть мастер
// можно в любой момент — работа не потеряется, продолжить можно в карточке шаблона.
export function TemplateWizard({ onClose }: TemplateWizardProps) {
  const t = useTranslations('DocumentTemplates')
  const qc = useQueryClient()
  const { errorToast } = useTemplateTexts()
  const [step, setStep] = useState(0)
  const [detail, setDetail] = useState<DocumentTemplateDetail | null>(null)
  const [showCatalog, setShowCatalog] = useState(false)

  const create = useMutation({
    mutationFn: createDocumentTemplate,
    onSuccess: (created) => {
      setDetail(created)
      void qc.invalidateQueries({ queryKey: documentTemplateKeys.all })
      setStep(1)
    },
    onError: (e) => toast.error(errorToast(e)),
  })

  const actions = useTemplateActions(detail?.id ?? '')
  const validation = detail?.versions[0]?.validation ?? null
  const valid = validation?.valid === true

  const footer = (next: { label: string; onClick: () => void; disabled?: boolean }) => (
    <div className="flex items-center justify-between gap-2 pt-2">
      <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
        {t('back')}
      </Button>
      <Button onClick={next.onClick} disabled={next.disabled}>
        {next.label} <ArrowRight className="size-4" aria-hidden />
      </Button>
    </div>
  )

  return (
    <Modal onClose={() => onClose(detail?.id)} title={t('wizardTitle')} size="xl" height="tall">
      <div className="flex flex-col gap-5">
        <Stepper
          steps={STEPS.map((id) => ({ id, label: t(`step_${id}`) }))}
          current={step}
          done={step}
        />

        {step === 0 && (
          <TemplateInfoForm
            submitLabel={t('createAndContinue')}
            pending={create.isPending}
            onSubmit={(values) => create.mutate(values)}
            onCancel={() => onClose()}
          />
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4 text-sm">
            <p>{t('prepareIntro')}</p>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5">
              {(['1', '2', '3', '4', '5', '6'] as const).map((n) => (
                <li key={n}>{t(`prepare_${n}`)}</li>
              ))}
            </ol>
            <div className="grid gap-3 sm:grid-cols-2">
              <figure className="rounded-lg border bg-muted/40 p-3">
                <figcaption className="mb-1 text-xs font-medium text-muted-foreground">
                  {t('exampleBefore')}
                </figcaption>
                <p>{t('exampleBeforeText')}</p>
              </figure>
              <figure className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                <figcaption className="mb-1 text-xs font-medium text-muted-foreground">
                  {t('exampleAfter')}
                </figcaption>
                <p className="break-words">
                  {t('exampleAfterText', {
                    fullName: asTag('student.fullName'),
                    course: asTag('student.course'),
                  })}
                </p>
              </figure>
            </div>
            <Button
              variant="outline"
              className="w-fit"
              onClick={() => setShowCatalog((v) => !v)}
              aria-expanded={showCatalog}
            >
              <ListChecks className="size-4" aria-hidden />
              {showCatalog ? t('hideCatalog') : t('openCatalog')}
            </Button>
            {showCatalog && <VariableCatalog compact />}
            {footer({ label: t('next'), onClick: () => setStep(2) })}
          </div>
        )}

        {step === 2 && detail && (
          <div className="flex flex-col gap-4 text-sm">
            <p>{t('uploadIntro')}</p>
            <TemplateUpload
              templateId={detail.id}
              onUploaded={(next) => {
                setDetail(next)
                setStep(3)
              }}
            />
            <div className="flex justify-start pt-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                {t('back')}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && validation && (
          <div className="flex flex-col gap-4">
            <ValidationReport validation={validation} />
            {valid ? (
              footer({ label: t('next'), onClick: () => setStep(4) })
            ) : (
              <div className="flex justify-end pt-2">
                <Button onClick={() => setStep(2)}>{t('uploadFixed')}</Button>
              </div>
            )}
          </div>
        )}

        {step === 4 && detail && (
          <div className="flex flex-col gap-4 text-sm">
            <p>{t('testIntro')}</p>
            <ul className="grid list-disc gap-1 pl-5 sm:grid-cols-2">
              {(['text', 'tables', 'lines', 'fonts', 'headers', 'logos', 'layout'] as const).map(
                (k) => (
                  <li key={k}>{t(`testCheck_${k}`)}</li>
                ),
              )}
            </ul>
            <Button
              className="w-fit"
              loading={actions.test.isPending}
              onClick={() => actions.test.mutate(undefined)}
            >
              <Download className="size-4" aria-hidden /> {t('testButton')}
            </Button>
            {footer({ label: t('next'), onClick: () => setStep(5) })}
          </div>
        )}

        {step === 5 && detail && (
          <div className="flex flex-col gap-4 text-sm">
            <p>{valid ? t('publishIntro') : t('publishBlocked')}</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="outline" onClick={() => onClose(detail.id)}>
                {t('keepDraft')}
              </Button>
              <Button
                disabled={!valid}
                loading={actions.publish.isPending}
                onClick={() =>
                  actions.publish.mutate(undefined, { onSuccess: () => onClose(detail.id) })
                }
              >
                {t('publish')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
