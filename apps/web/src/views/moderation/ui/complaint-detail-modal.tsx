'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import {
  complaintKeys,
  fetchComplaintMessages,
  reopenComplaintRequest,
  resolveComplaintRequest,
  takeComplaintRequest,
  type Complaint,
  complaintPriority,
  PRIORITY_STYLE,
  STATUS_STYLE,
} from '../../../entities/complaint'
import { ProfileLink } from '../../../entities/user'
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  Modal,
  SegmentedTabs,
  useConfirm,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { useAppSelector } from '../../../shared/store'
import { cn } from '../../../shared/lib/utils'

type Decision = 'DELETE_CONTENT' | 'BLOCK_USER' | 'WARN_USER' | 'DISMISS'

// Срок блокировки: 0 — бессрочно. Три значения, а не поле ввода — как в мини-аппе: «7» и
// «70» в поле различаются одним промахом, а цена промаха здесь — чужой доступ.
const BLOCK_TERMS = [
  { days: 0, key: 'blockForever' },
  { days: 7, key: 'blockWeek' },
  { days: 30, key: 'blockMonth' },
] as const
type BlockTerm = (typeof BLOCK_TERMS)[number]['days']

/** Пара «подпись — значение» списка деталей. Все пары одной сетки, поэтому колонки ровные. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{children}</dd>
    </div>
  )
}

// Детали жалобы и решение по ней. Раньше это жило прямо в строке очереди: каждая карточка
// держала поле комментария и три кнопки, из-за чего в очередь влезало 4–5 жалоб. Теперь
// очередь — таблица, а разбор одной жалобы — здесь.
//
// Структура окна: шапка (бейджи + причина как заголовок) → `dl` с деталями в две колонки →
// секции переписки и комментария → подвал с действиями. Заголовки секций и пары `dt/dd`
// вместо «просто текста» — чтобы скринридер читал окно как документ, а не как поток строк.
export function ComplaintDetailModal({
  complaint,
  onClose,
}: {
  complaint: Complaint
  onClose: () => void
}) {
  const t = useTranslations('Moderation')
  const tCommon = useTranslations('Common')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const myId = useAppSelector((st) => st.auth.user?.id)
  const [comment, setComment] = useState('')
  const [showChat, setShowChat] = useState(false)
  const [applyToDuplicates, setApplyToDuplicates] = useState(false)
  const [blockDays, setBlockDays] = useState<BlockTerm>(0)
  const reviewer = complaint.reviewingBy ?? null
  const takenByOther = reviewer !== null && reviewer.id !== myId

  const isOpen = complaint.status === 'PENDING' || complaint.status === 'REVIEWING'
  const priorityValue = complaintPriority(complaint)

  const messages = useQuery({
    queryKey: complaintKeys.messages(complaint.id),
    queryFn: () => fetchComplaintMessages(complaint.id),
    enabled: showChat,
    // 404 (сообщение удалено или его нет) повторами не лечится, а три ретрая держали бы
    // «Загрузка…» на экране несколько секунд вместо объяснения.
    retry: false,
  })

  const resolveMut = useMutation({
    mutationFn: (action: Decision) =>
      resolveComplaintRequest(complaint.id, {
        action,
        comment: comment.trim() || undefined,
        applyToDuplicates: applyToDuplicates || undefined,
        blockDays: action === 'BLOCK_USER' && blockDays > 0 ? blockDays : undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: complaintKeys.all })
      toast.success(t('resolved'))
      onClose()
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  const takeMut = useMutation({
    mutationFn: () => takeComplaintRequest(complaint.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: complaintKeys.all })
      toast.success(t('taken'))
    },
    // CONFLICT — жалобу уже взял другой: сервер не даёт перехватить чужую.
    onError: (e) => {
      const code = toApiError(e).code
      toast.error(code === 'CONFLICT' ? t('takenByOther') : tErr(code))
    },
  })

  const reopenMut = useMutation({
    mutationFn: () => reopenComplaintRequest(complaint.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: complaintKeys.all })
      toast.success(t('reopened'))
      onClose()
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  // Жёсткие меры — через подтверждение: блокировка отключает человека от платформы, а
  // предупреждение уходит ему уведомлением и остаётся в истории модерации навсегда.
  async function decide(action: Decision): Promise<void> {
    if (action === 'BLOCK_USER' || action === 'WARN_USER') {
      const ok = await confirm({
        title:
          action === 'WARN_USER'
            ? t('confirmWarn')
            : blockDays === 0
              ? t('confirmBlockForever')
              : t('confirmBlockFor', { days: blockDays }),
        destructive: action === 'BLOCK_USER',
      })
      if (!ok) return
    }
    resolveMut.mutate(action)
  }

  const pill = 'rounded-full px-2 py-0.5 text-xs font-medium'

  return (
    <Modal onClose={onClose} title={t('detailTitle')} size="lg">
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(pill, PRIORITY_STYLE[priorityValue])}>
              {t(`priority${priorityValue}`)}
            </span>
            {complaint.targetType === 'USER' ? (
              <ProfileLink userId={complaint.targetId}>
                <Badge variant="outline" className="hover:border-primary hover:text-primary">
                  {t(`target${complaint.targetType}`)}
                </Badge>
              </ProfileLink>
            ) : (
              <Badge variant="outline">{t(`target${complaint.targetType}`)}</Badge>
            )}
            <span className={cn(pill, STATUS_STYLE[complaint.status])}>
              {t(`status${complaint.status}`)}
            </span>
          </div>
          <h3 className="text-base font-semibold">{complaint.reason}</h3>
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Field label={t('reporter')}>
            <ProfileLink
              userId={complaint.reporter.id}
              className="hover:text-primary hover:underline"
            >
              {complaint.reporter.lastName} {complaint.reporter.firstName}
            </ProfileLink>
          </Field>
          <Field label={t('colDate')}>
            {new Date(complaint.createdAt).toLocaleString(locale, {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Field>
          {isOpen && (
            <Field label={t('reviewingBy')}>
              {reviewer ? `${reviewer.lastName} ${reviewer.firstName}` : t('notTaken')}
            </Field>
          )}
          {/* Вторая пара появляется только у обработанных жалоб — сетка остаётся ровной:
              либо две ячейки, либо четыре. */}
          {!isOpen && (
            <>
              <Field label={t('resolution')}>{complaint.resolution ?? '—'}</Field>
              <Field label={t('resolvedBy')}>
                {complaint.resolvedBy ? (
                  <ProfileLink
                    userId={complaint.resolvedBy.id}
                    className="hover:text-primary hover:underline"
                  >
                    {complaint.resolvedBy.lastName} {complaint.resolvedBy.firstName}
                  </ProfileLink>
                ) : (
                  '—'
                )}
              </Field>
            </>
          )}
        </dl>

        {/* Доступ к переписке по жалобе на сообщение (открытие пишется в аудит на бэке). */}
        {complaint.targetType === 'MESSAGE' && (
          <section className="flex flex-col gap-2 rounded-xl border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-medium">{t('chatTitle')}</h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowChat((v) => !v)}
              >
                {showChat ? t('hideChat') : t('showChat')}
              </Button>
            </div>
            {showChat &&
              (messages.isLoading ? (
                <p className="text-xs text-muted-foreground">{t('loadingChat')}</p>
              ) : messages.isError ? (
                // Жалоба может ссылаться на удалённое (или уже не существующее) сообщение —
                // тогда сервер отдаёт 404, и это нормальный исход, а не сбой.
                <p className="text-xs text-muted-foreground">{t('chatUnavailable')}</p>
              ) : (messages.data ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('chatEmpty')}</p>
              ) : (
                <ul className="flex max-h-60 flex-col gap-1.5 overflow-y-auto">
                  {(messages.data ?? []).map((m) => (
                    <li key={m.id} className="text-sm">
                      <ProfileLink userId={m.senderId} className="font-medium hover:underline">
                        {m.sender.lastName} {m.sender.firstName}
                      </ProfileLink>
                      :{' '}
                      <span className={cn(m.deletedAt && 'text-muted-foreground line-through')}>
                        {m.content}
                      </span>
                    </li>
                  ))}
                </ul>
              ))}
          </section>
        )}

        {isOpen && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="complaint-comment">{t('commentLabel')}</Label>
              <Input
                id="complaint-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t('commentPlaceholder')}
              />
            </div>
            {/* Десять жалоб на один пост — обычное дело; мера при этом выполняется один
                раз, остальные жалобы просто получают тот же статус. */}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={applyToDuplicates}
                onCheckedChange={(v) => setApplyToDuplicates(v === true)}
              />
              {t('applyToDuplicates')}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">{t('blockTerm')}</span>
              <SegmentedTabs<`${BlockTerm}`>
                aria-label={t('blockTerm')}
                compact
                value={`${blockDays}`}
                onChange={(v) => setBlockDays(Number(v) as BlockTerm)}
                items={BLOCK_TERMS.map((term) => ({
                  value: `${term.days}` as `${BlockTerm}`,
                  label: t(term.key),
                }))}
              />
            </div>
          </section>
        )}

        {/* Подвал: слева выход без решения, справа — сами решения, от мягкого к жёсткому. */}
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('close')}
          </Button>
          {isOpen && takenByOther && (
            <p className="text-sm text-muted-foreground">{t('takenByOtherHint')}</p>
          )}
          {isOpen && !takenByOther && (
            <div className="flex flex-wrap justify-end gap-2">
              {reviewer === null && (
                <Button
                  type="button"
                  variant="outline"
                  loading={takeMut.isPending}
                  onClick={() => takeMut.mutate()}
                >
                  {t('take')}
                </Button>
              )}
              <Button
                type="button"
                loading={resolveMut.isPending && resolveMut.variables === 'DISMISS'}
                onClick={() => void decide('DISMISS')}
              >
                {t('dismiss')}
              </Button>
              <Button
                type="button"
                variant="outline"
                loading={resolveMut.isPending && resolveMut.variables === 'WARN_USER'}
                onClick={() => void decide('WARN_USER')}
              >
                {t('warnUser')}
              </Button>
              {complaint.targetType !== 'USER' && (
                <Button
                  type="button"
                  variant="destructive"
                  loading={resolveMut.isPending && resolveMut.variables === 'DELETE_CONTENT'}
                  onClick={() => void decide('DELETE_CONTENT')}
                >
                  {t('deleteContent')}
                </Button>
              )}
              <Button
                type="button"
                variant="destructive"
                loading={resolveMut.isPending && resolveMut.variables === 'BLOCK_USER'}
                onClick={() => void decide('BLOCK_USER')}
              >
                {blockDays === 0 ? t('blockUser') : t('blockUserFor', { days: blockDays })}
              </Button>
            </div>
          )}
          {!isOpen && (
            <Button
              type="button"
              variant="outline"
              loading={reopenMut.isPending}
              onClick={() => reopenMut.mutate()}
            >
              {t('reopen')}
            </Button>
          )}
        </footer>
      </div>
    </Modal>
  )
}
