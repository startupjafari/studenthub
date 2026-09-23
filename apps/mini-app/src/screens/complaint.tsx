import { useCallback, useEffect, useState } from 'react'
import {
  fetchComplaint,
  fetchComplaintMessages,
  reopenComplaint,
  resolveComplaint,
  takeComplaint,
  type ComplaintCard,
  type ComplaintMessage,
  type ResolveAction,
} from '../api/complaints'
import { ApiError } from '../api/client'
import { confirmAction, haptic } from '../telegram/webapp'
import { useBackButton } from '../telegram/use-telegram'
import { t } from '../i18n'
import { formatDateTime } from '../lib/format'
import { PersonSummary } from './person-summary'

// Карточка разбора жалобы: прочитать целиком и принять решение с телефона.
//
// Решений три, поэтому MainButton здесь не используется: она одна, а выбор между «снять
// контент», «заблокировать» и «отклонить» — это и есть работа модератора. Кнопки стоят
// в потоке, разрушительные отличаются цветом.

const TARGET_KEY = {
  USER: 'targetUser',
  MESSAGE: 'targetMessage',
  POST: 'targetPost',
  STORY: 'targetStory',
  COMMENT: 'targetComment',
} as const

const PRIORITY_KEY = {
  HIGH: 'priorityHigh',
  MEDIUM: 'priorityMedium',
  LOW: 'priorityLow',
} as const

// Сроки блокировки. Три значения вместо поля ввода: выбор из трёх делается одним касанием
// и не даёт промахнуться разрядом. 0 — бессрочно, как было до появления сроков.
/**
 * Ссылка на карточку для коллеги.
 *
 * `https://t.me/<бот>/<приложение>?startapp=complaint_<id>` открывает мини-апп сразу на
 * этой жалобе. Адрес самой страницы для этого не годится: по нему коллега попадёт в
 * браузер без подписи Telegram и увидит «откройте из Telegram». Имя бота приходит
 * сборкой — в initData его нет; не задано, делимся тем, что есть.
 */
function shareLink(id: string): string {
  const base = import.meta.env.VITE_TG_APP_LINK
  return base
    ? `${base}?startapp=complaint_${id}`
    : `${location.origin}${location.pathname}?startapp=complaint_${id}`
}

const BLOCK_TERMS = [
  { days: 0, key: 'blockForever' },
  { days: 7, key: 'blockWeek' },
  { days: 30, key: 'blockMonth' },
] as const

type Loaded = ComplaintCard

type State = { status: 'loading' } | { status: 'ready'; complaint: Loaded } | { status: 'error' }

export function ComplaintScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [context, setContext] = useState<ComplaintMessage[] | 'error' | null>(null)
  const [comment, setComment] = useState('')
  const [applyAll, setApplyAll] = useState(false)
  const [code, setCode] = useState('')
  // Срок блокировки: 0 — бессрочно. Выбор из трёх значений, а не поле ввода: на телефоне
  // набирать число незачем, а «7» и «70» в поле различаются одним промахом.
  const [blockDays, setBlockDays] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useBackButton(onBack)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const complaint = await fetchComplaint(id)
      setState({ status: 'ready', complaint })

      // Переписка — только для жалоб на сообщение, и грузится отдельно: её отсутствие
      // не должно мешать принять решение, а сервер на остальных типах отвечает отказом.
      if (complaint.targetType === 'MESSAGE') {
        try {
          setContext(await fetchComplaintMessages(id))
        } catch {
          setContext('error')
        }
      }
    } catch {
      setState({ status: 'error' })
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const decide = useCallback(
    async (action: ResolveAction, question: string) => {
      if (busy) return
      if (!(await confirmAction(question))) return

      setBusy(true)
      setError(null)
      try {
        await resolveComplaint(id, action, {
          comment: comment.trim() || undefined,
          applyToDuplicates: applyAll,
          // Код нужен только блокировке: предупреждение и «нарушения нет» обратимы.
          code: action === 'BLOCK_USER' ? code : undefined,
          blockDays: action === 'BLOCK_USER' && blockDays > 0 ? blockDays : undefined,
        })
        haptic.success()
        // Возвращаемся в очередь: разобранной жалобы в ней уже нет, и оставаться
        // на карточке, которая больше ничего не ждёт, незачем.
        onBack()
      } catch (err) {
        // Текст от сервера: он знает, почему нельзя (например, «жалоба уже обработана»
        // другим модератором), а выдумывать свою формулировку значило бы врать.
        setError(err instanceof ApiError ? err.message : t('complaintApplyError'))
      } finally {
        setBusy(false)
      }
    },
    [applyAll, blockDays, busy, code, comment, id, onBack],
  )

  const reopen = useCallback(async () => {
    if (!(await confirmAction(t('complaintReopenConfirm')))) return
    setBusy(true)
    setError(null)
    try {
      await reopenComplaint(id)
      haptic.success()
      onBack()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('complaintReopenError'))
    } finally {
      setBusy(false)
    }
  }, [id, onBack])

  if (state.status === 'loading') {
    // Скелетон, а не строка «Открываем…»: форма будущей карточки известна заранее, и
    // экран не прыгает, когда данные приезжают.
    return (
      <div className="screen">
        <header className="screen-head">
          <h1>{t('complaintTitle')}</h1>
          <p className="hint">{t('complaintOpening')}</p>
        </header>
        <section className="card" aria-hidden="true">
          <span className="skeleton skeleton-title" />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line" />
        </section>
        <section className="card" aria-hidden="true">
          <span className="skeleton skeleton-title" />
          <span className="skeleton skeleton-line" />
        </section>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="screen">
        <header className="screen-head">
          <h1>{t('complaintTitle')}</h1>
        </header>
        <section className="card">
          <p>{t('complaintOpenError')}</p>
          <button type="button" className="fallback-submit" onClick={() => void load()}>
            {t('retry')}
          </button>
        </section>
      </div>
    )
  }

  const { complaint } = state
  const isUser = complaint.targetType === 'USER'

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>{t(TARGET_KEY[complaint.targetType])}</h1>
        <p className="hint">
          {t(PRIORITY_KEY[complaint.priority])} · {formatDateTime(complaint.createdAt)}
        </p>
      </header>

      <section className="card">
        <h2>{t('complaintReasonTitle')}</h2>
        {/* Текст жалобы целиком: в очереди видна только первая строка, а решение
            принимается по всему тексту. */}
        <p>{complaint.reason}</p>
        {/* Ссылка на карточку: передать коллеге конкретную жалобу, а не «посмотри
            в очереди». Тот же формат, что в уведомлениях бота. */}
        <button
          type="button"
          className="chip"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(shareLink(id))
              .then(() => {
                haptic.success()
                setError(t('complaintShared'))
              })
              .catch(() => setError(t('complaintShareFailed')))
          }}
        >
          {t('complaintShare')}
        </button>
        <p className="hint">
          {complaint.reporter
            ? t('complaintReporter', {
                name: `${complaint.reporter.lastName} ${complaint.reporter.firstName}`,
              })
            : t('complaintReporterGone')}
        </p>
        {/* Больше одной жалобы на ту же цель — признак, которого не видно в тексте:
            единичная обида и травля выглядят одинаково, пока не посмотришь на счётчик. */}
        {complaint.targetReports > 1 && (
          <p className="hint hint-danger">
            {t('complaintRepeats', { count: complaint.targetReports })}
          </p>
        )}
      </section>

      {/* Кто нарушил. Решение принимается про человека, а в жалобе на пост или сообщение
          видно только текст: студент первого курса и модератор вуза с одинаковой жалобой —
          разные случаи, и «попадался раньше» меняет меру. */}
      {complaint.targetOwnerId && (
        <PersonSummary userId={complaint.targetOwnerId} title={t('complaintOffender')} />
      )}

      {complaint.targetType === 'MESSAGE' && (
        <section className="card">
          <h2>{t('complaintContextTitle')}</h2>
          {context === null && <p className="hint">{t('complaintOpening')}</p>}
          {context === 'error' && <p className="hint">{t('complaintContextError')}</p>}
          {Array.isArray(context) && context.length === 0 && (
            <p className="hint">{t('complaintContextEmpty')}</p>
          )}
          {Array.isArray(context) &&
            context.map((message) => (
              <p key={message.id} className="quote">
                <b>{message.sender.firstName}</b> {message.content}
              </p>
            ))}
        </section>
      )}

      {error && (
        <section className="card">
          <p className="hint-danger">{error}</p>
        </section>
      )}

      {/* Разобранную жалобу решать нечем — её можно только вернуть в очередь. */}
      {complaint.status !== 'PENDING' && complaint.status !== 'REVIEWING' && (
        <section className="card">
          <h2>{t('complaintDecision')}</h2>
          <p className="hint">
            {complaint.resolvedAt
              ? t('complaintResolvedAt', { when: formatDateTime(complaint.resolvedAt) })
              : ''}
          </p>
          <button
            type="button"
            className="fallback-submit secondary"
            disabled={busy}
            onClick={() => void reopen()}
          >
            {t('complaintReopen')}
          </button>
        </section>
      )}

      {(complaint.status === 'PENDING' || complaint.status === 'REVIEWING') && (
        <section className="card">
          <h2>{t('complaintDecision')}</h2>
          {/* Квитирование. То же самое делает кнопка под уведомлением в Telegram: без
            отметки «я взял» двое открывают одну жалобу, а третью не берёт никто. */}
          {complaint.reviewingBy ? (
            <p className="hint">
              {t('complaintTakenBy', {
                name: `${complaint.reviewingBy.lastName} ${complaint.reviewingBy.firstName}`,
              })}
            </p>
          ) : (
            <button
              type="button"
              className="chip"
              disabled={busy}
              onClick={() => {
                void takeComplaint(id)
                  .then(() => {
                    haptic.success()
                    void load()
                  })
                  .catch((err: unknown) =>
                    setError(err instanceof ApiError ? err.message : t('complaintTakeError')),
                  )
              }}
            >
              {t('complaintTake')}
            </button>
          )}
          {/* Комментарий необязателен, но уходит в журнал вместе с решением: через месяц
            «почему заблокировали» отвечается только им. */}
          <textarea
            className="field"
            rows={2}
            maxLength={2000}
            placeholder={t('complaintNotePlaceholder')}
            aria-label={t('complaintNoteLabel')}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          {/* Для жалобы на пользователя удаление контента недопустимо — правило сервера,
            и кнопку здесь просто не рисуем, чтобы не предлагать заведомый отказ. */}
          {!isUser && (
            <button
              type="button"
              className="fallback-submit danger"
              disabled={busy}
              onClick={() => void decide('DELETE_CONTENT', t('complaintConfirmDelete'))}
            >
              {t('complaintDeleteContent')}
            </button>
          )}
          {/* Промежуточная мера. До неё шкала шла от «нарушения нет» сразу к блокировке,
            и на первый грубый комментарий приходилось выбирать между «ничего» и
            отключением человека от платформы. Кода не требует: предупреждение обратимо
            ровно в той мере, в какой обратим разговор. */}
          <button
            type="button"
            className="fallback-submit secondary"
            disabled={busy}
            onClick={() => void decide('WARN_USER', t('complaintConfirmWarn'))}
          >
            {t('complaintWarnUser')}
          </button>

          {/* Срок блокировки. «Навсегда» остаётся первым и выбранным по умолчанию:
            менять смысл кнопки молча нельзя. */}
          <div className="chips-grid">
            {BLOCK_TERMS.map((term) => (
              <button
                key={term.days}
                type="button"
                className="chip"
                aria-pressed={blockDays === term.days}
                disabled={busy}
                onClick={() => {
                  haptic.select()
                  setBlockDays(term.days)
                }}
              >
                {t(term.key)}
              </button>
            ))}
          </div>

          {/* Код нужен только блокировке: «снять контент» и «нарушения нет» обратимы. */}
          <input
            className="field"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={t('confirmCodeLabel')}
            aria-label={t('confirmCodeLabel')}
            value={code}
            onChange={(event) => setCode(event.target.value.trim())}
          />
          {/* Срок стоит и в подтверждении, и на кнопке: диалог «заблокировать?» без срока
            означал бы разное в зависимости от чипа выше, а это ровно то место, где
            двусмысленность стоит человеку доступа. */}
          <button
            type="button"
            className="fallback-submit danger"
            disabled={busy || code.length < 6}
            onClick={() =>
              void decide(
                'BLOCK_USER',
                blockDays === 0
                  ? t('complaintConfirmBlock')
                  : t('complaintConfirmBlockFor', { days: blockDays }),
              )
            }
          >
            {blockDays === 0
              ? t('complaintBlockUser')
              : t('complaintBlockUserFor', { days: blockDays })}
          </button>
          <button
            type="button"
            className="fallback-submit"
            disabled={busy}
            onClick={() => void decide('DISMISS', t('complaintConfirmDismiss'))}
          >
            {t('complaintDismiss')}
          </button>

          {/* Десять жалоб на один пост — обычное дело. Побочное действие при этом
            выполнится один раз, остальные жалобы просто получат тот же статус. */}
          {complaint.targetReports > 1 && (
            <button
              type="button"
              className="chip"
              aria-pressed={applyAll}
              disabled={busy}
              onClick={() => setApplyAll((value) => !value)}
            >
              {t('complaintApplyAll', { count: complaint.targetReports })}
            </button>
          )}
        </section>
      )}
    </div>
  )
}
