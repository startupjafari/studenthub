'use client'

import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { BadgeCheck, CloudOff, FileWarning, Loader2, RotateCcw, ShieldX } from 'lucide-react'
import { verificationKeys, verifyDocument } from '../../../entities/document-verification'
import { Button, Card, CardContent } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'

/**
 * Публичная проверка выданного документа по коду из бланка.
 *
 * Её открывают те, у кого аккаунта в StudentHub нет и не будет: банк, работодатель,
 * посольство. Поэтому страница отвечает ровно на один вопрос — «этот документ настоящий и
 * действует?» — и не показывает ни содержания справки, ни полного имени: код короткий, а
 * значит подбираем, и по нему нельзя раздавать персональные данные.
 *
 * Для казахстанской ЭЦП это ещё и основной путь проверки: обычные читалки PDF ГОСТ-подпись
 * не понимают и показывают «подпись недействительна», так что человеку с бумагой в руках
 * остаётся QR и этот экран.
 */
export function VerifyDocumentView({ code }: { code: string }) {
  const t = useTranslations('Verify')
  const tCommon = useTranslations('Common')
  const locale = useLocale()

  const query = useQuery({
    queryKey: verificationKeys.byCode(code),
    queryFn: () => verifyDocument(code),
    // Без автоповторов: каждый тратит лимит проверок с адреса (20 в минуту), а банк проверяет
    // пачку справок с одного IP. Повтор — кнопкой, когда человек сам решит.
    retry: false,
  })

  if (query.isLoading) {
    return (
      <Shell>
        <Loader2 className="size-10 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      </Shell>
    )
  }

  // «Не найдено» — только когда сервер так и ответил. Лимит запросов, 5xx и обрыв сети —
  // это «проверить не удалось»: показанный под ними «Документ не найден» выдавал подлинную
  // справку за подделку. Подсказки перебирающему здесь нет: лимит и так виден в ответе.
  if (query.isError && toApiError(query.error).code !== 'NOT_FOUND') {
    const limited = toApiError(query.error).code === 'RATE_LIMIT'
    return (
      <Shell>
        <CloudOff className="size-10 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">{t('failedTitle')}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          {limited ? t('rateLimitedHint') : t('failedHint')}
        </p>
        <Code value={code} />
        <Button variant="outline" loading={query.isFetching} onClick={() => void query.refetch()}>
          <RotateCcw className="size-4" aria-hidden />
          {tCommon('retry')}
        </Button>
      </Shell>
    )
  }

  if (query.isError || !query.data) {
    return (
      <Shell>
        <FileWarning className="size-10 text-destructive" aria-hidden />
        <h1 className="text-lg font-semibold">{t('notFoundTitle')}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t('notFoundHint')}</p>
        <Code value={code} />
      </Shell>
    )
  }

  const doc = query.data
  const revoked = doc.status === 'REVOKED'
  // В журнале лежат и рабочие выгрузки (списки, переписка). Зелёная отметка на них была
  // бы обманом: подтверждать там нечего, это не документ.
  const official = doc.kind === 'certificate'

  return (
    <Shell>
      <div
        className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-center text-sm font-semibold ${
          revoked
            ? 'bg-destructive/10 text-destructive'
            : official
              ? 'bg-success/10 text-success'
              : 'bg-muted text-muted-foreground'
        }`}
      >
        {revoked ? (
          <ShieldX className="size-5 shrink-0" aria-hidden />
        ) : official ? (
          <BadgeCheck className="size-5 shrink-0" aria-hidden />
        ) : (
          <FileWarning className="size-5 shrink-0" aria-hidden />
        )}
        {revoked ? t('revokedBadge') : official ? t('validBadge') : t('notOfficialBadge')}
      </div>

      <Card className="w-full">
        <CardContent className="flex flex-col gap-3 p-5">
          <Row label={t('kind')} value={official ? t('kind_certificate') : t('kind_other')} />
          <Row label={t('number')} value={doc.number} />
          <Row label={t('subject')} value={doc.subject} />
          <Row label={t('issuer')} value={doc.issuer} />
          <Row label={t('issuedAt')} value={formatDate(doc.issuedAt, locale)} />
          {revoked && doc.revokedAt && (
            <Row label={t('revokedAt')} value={formatDate(doc.revokedAt, locale)} />
          )}
        </CardContent>
      </Card>

      <Code value={doc.code} />
      <p className="max-w-sm text-center text-xs text-muted-foreground">{t('privacyHint')}</p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 p-4">
      {children}
    </div>
  )
}

/** Строка «подпись → значение». Пустое значение не показываем: прочерк ничего не сообщает. */
function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  )
}

/** Код из бланка — крупно и с разрядкой: его сверяют глазами с бумагой. */
function Code({ value }: { value: string }) {
  return <p className="text-sm tracking-[0.3em] text-muted-foreground">{value.toUpperCase()}</p>
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
