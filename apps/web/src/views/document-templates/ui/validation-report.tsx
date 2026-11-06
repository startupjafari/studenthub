'use client'

import { useTranslations } from 'next-intl'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import type { DocumentTemplateValidation } from '@studenthub/shared-schemas'
import { Badge } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { asTag, useTemplateTexts } from '../lib/use-template-texts'

interface ValidationReportProps {
  validation: DocumentTemplateValidation
  className?: string
}

// Итог проверки версии шаблона: годен ли он, какие переменные найдены, что исправить.
// Без технических структур — только человеческие формулировки по кодам замечаний.
export function ValidationReport({ validation, className }: ValidationReportProps) {
  const t = useTranslations('DocumentTemplates')
  const { variableLabel, issueText } = useTemplateTexts()
  const { valid, variables, errors, warnings } = validation

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div
        role="status"
        className={cn(
          'flex items-start gap-3 rounded-lg border p-3 text-sm',
          valid ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5',
        )}
      >
        {valid ? (
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        ) : (
          <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
        )}
        <div className="flex flex-col gap-0.5">
          <p className="font-medium">{valid ? t('checkOk') : t('checkFailed')}</p>
          <p className="text-muted-foreground">
            {valid ? t('checkOkHint') : t('checkFailedHint', { count: errors.length })}
          </p>
        </div>
      </div>

      {errors.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="tpl-errors">
          <h3 id="tpl-errors" className="text-sm font-semibold">
            {t('errorsTitle')}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {errors.map((issue) => (
              <li
                key={`${issue.code}-${issue.tag ?? ''}-${issue.part ?? ''}`}
                className="flex items-start gap-2 text-sm"
              >
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                <span className="min-w-0 break-words">{issueText(issue)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2" aria-labelledby="tpl-found">
        <h3 id="tpl-found" className="text-sm font-semibold">
          {t('foundVariables', { count: variables.length })}
        </h3>
        {variables.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noVariablesFound')}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {variables.map((key) => (
              <li key={key}>
                <Badge variant="secondary" className="gap-1.5 whitespace-normal">
                  <span>{variableLabel(key)}</span>
                  <code className="font-mono text-[11px] opacity-70">{asTag(key)}</code>
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {warnings.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="tpl-warnings">
          <h3 id="tpl-warnings" className="text-sm font-semibold">
            {t('warningsTitle')}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {warnings.map((issue) => (
              <li
                key={`${issue.code}-${issue.tag ?? ''}`}
                className="flex items-start gap-2 text-sm text-muted-foreground"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <span className="min-w-0 break-words">{issueText(issue)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
