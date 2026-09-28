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
import { confirmAction, haptic, hasBottomButtons } from '../telegram/webapp'
import { useBackButton, useMainButton, useSecondaryButton } from '../telegram/use-telegram'
import { ScreenHeader } from '../ui/screen-header'
import { StatePlate } from '../ui/state-plate'
import { SkeletonCards } from '../ui/skeleton'
import { t } from '../i18n'
import { formatDateTime } from '../lib/format'
import { PersonSummary } from './person-summary'

// Карточка разбора жалобы: прочитать целиком и принять решение с телефона.
//
// Два самых частых решения — на нативных кнопках Telegram внизу, у большого пальца:
// «Нарушения нет» главной и «Снять контент» второй, красной (у жалобы на человека вместо
// неё — «Предупредить»: контента, который можно снять, там нет). Блокировка остаётся в
// карточке: ей нужны срок и код, а их на кнопку не посадить. У клиентов без второй кнопки
// (до Bot API 7.10) все решения, как и раньше, стоят в потоке экрана.
//
// После решения открывается следующая жалоба очереди, а не список: очередь разбирают
// подряд, и возврат в список после каждой жалобы превращал разбор в хождение туда-обратно.

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

/** Разбор подряд: сколько уже разобрано в этом заходе и сколько осталось вместе с текущей. */
export interface TriageProgress {
  done: number
  left: number
}

export function ComplaintScreen({
  id,
  onBack,
  onDone = onBack,
  onSkip,
  triage,
}: {
  id: string
  onBack: () => void
  /** Решение принято — куда дальше. По умолчанию назад в очередь. */
  onDone?: () => void
  /** Перейти к следующей жалобе, не решая эту. Нет — последняя в очереди. */
  onSkip?: () => void
  triage?: TriageProgress
}) {
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
  // Один раз: версия клиента за время жизни экрана не меняется.
  const [native] = useState(hasBottomButtons)

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
    async (
      action: ResolveAction,
      question: string,
      confirm?: { ok?: string; destructive?: boolean },
    ) => {
      if (busy) return
      if (!(await confirmAction(question, confirm))) return

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
        // Дальше — следующая жалоба очереди (или сама очередь, если эта была последней):
        // оставаться на карточке, которая больше ничего не ждёт, незачем.
        onDone()
      } catch (err) {
        // Текст от сервера: он знает, почему нельзя (например, «жалоба уже обработана»
        // другим модератором), а выдумывать свою формулировку значило бы врать.
        setError(err instanceof ApiError ? err.message : t('complaintApplyError'))
      } finally {
        setBusy(false)
      }
    },
    [applyAll, blockDays, busy, code, comment, id, onDone],
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

  const pending =
    state.status === 'ready' &&
    (state.complaint.status === 'PENDING' || state.complaint.status === 'REVIEWING')
  const onUser = state.status === 'ready' && state.complaint.targetType === 'USER'

  const dismiss = (): void =>
    void decide('DISMISS', t('complaintConfirmDismiss'), { ok: t('complaintDismiss') })
  const deleteContent = (): void =>
    void decide('DELETE_CONTENT', t('complaintConfirmDelete'), {
      destructive: true,
      ok: t('complaintDeleteContent'),
    })
  const warn = (): void =>
    void decide('WARN_USER', t('complaintConfirmWarn'), { ok: t('complaintWarnUser') })

  // Хуки нижних кнопок стоят до ранних выходов: на загрузке и отказе кнопок нет (текст
  // null), но порядок хуков обязан быть одним и тем же при каждой отрисовке.
  useMainButton(native && pending ? t('complaintDismiss') : null, dismiss, { busy })
  useSecondaryButton(
    native && pending ? (onUser ? t('complaintWarnUser') : t('complaintDeleteContent')) : null,
    onUser ? warn : deleteContent,
    // Слева от главной: главное решение остаётся под большим пальцем правой руки.
    { tone: onUser ? 'default' : 'destructive', busy, position: 'left' },
  )

  if (state.status === 'loading') {
    // Скелетон, а не строка «Открываем…»: форма будущей карточки известна заранее, и
    // экран не прыгает, когда данные приезжают.
    return (
      <div className="screen" aria-busy="true">
        <ScreenHeader title={t('complaintTitle')} />
        <SkeletonCards />
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="screen">
        <ScreenHeader title={t('complaintTitle')} />
        <StatePlate title={t('complaintOpenError')} onRetry={() => void load()} />
      </div>
    )
  }

  const { complaint } = state
  const isUser = complaint.targetType === 'USER'

  return (
    <div className="screen">
      <ScreenHeader title={t(TARGET_KEY[complaint.targetType])} />

      {/* Разбор подряд: видно, сколько сделано и сколько впереди. Полоса — чтобы ответ
          читался без цифр, «Пропустить» — чтобы спорная жалоба не держала всю очередь. */}
      {triage && (
        <div className="triage">
          <div className="triage-row">
            <span className="hint">
              {t('complaintTriage', { done: triage.done, left: triage.left })}
            </span>
            {onSkip && (
              <button
                type="button"
                className="chip"
                disabled={busy}
                onClick={() => {
                  haptic.select()
                  onSkip()
                }}
              >
                {t('complaintSkip')}
              </button>
            )}
          </div>
          <span className="triage-bar" aria-hidden>
            <span
              style={{
                width: `${(triage.done / Math.max(1, triage.done + triage.left)) * 100}%`,
              }}
            />
          </span>
        </div>
      )}

      <section className="card">
        <h2>{t('complaintReasonTitle')}</h2>
        {/* Приоритет и время стоят в карточке, а не под названием экрана: это сведения о
            самой жалобе, и читаются они вместе с её текстом, а не вместо заголовка. */}
        <p className="hint">
          {t(PRIORITY_KEY[complaint.priority])} · {formatDateTime(complaint.createdAt)}
        </p>
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
          {/* С нативными кнопками два главных решения уже внизу — здесь остальное. */}
          <h2>{native ? t('complaintMoreMeasures') : t('complaintDecision')}</h2>
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
          {/* Десять жалоб на один пост — обычное дело. Побочное действие при этом
            выполнится один раз, остальные жалобы просто получат тот же статус.
            Рядом с запиской, а не в самом конце: это условие любого решения, в том
            числе принятого нижними кнопками, и под блокировкой его не находили. */}
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
          {/* Без нативных кнопок главное решение — первым и залитым: под блокировкой
            в конце карточки оно читалось последним вариантом, а не основным. */}
          {!native && (
            <button type="button" className="fallback-submit" disabled={busy} onClick={dismiss}>
              {t('complaintDismiss')}
            </button>
          )}
          {/* Для жалобы на пользователя удаление контента недопустимо — правило сервера,
            и кнопку здесь просто не рисуем, чтобы не предлагать заведомый отказ. */}
          {!isUser && !native && (
            <button
              type="button"
              className="fallback-submit danger"
              disabled={busy}
              onClick={deleteContent}
            >
              {t('complaintDeleteContent')}
            </button>
          )}
          {/* Промежуточная мера. До неё шкала шла от «нарушения нет» сразу к блокировке,
            и на первый грубый комментарий приходилось выбирать между «ничего» и
            отключением человека от платформы. Кода не требует: предупреждение обратимо
            ровно в той мере, в какой обратим разговор. */}
          {/* У жалобы на человека «Предупредить» уже на второй нативной кнопке. */}
          {!(native && isUser) && (
            <button
              type="button"
              className="fallback-submit secondary"
              disabled={busy}
              onClick={warn}
            >
              {t('complaintWarnUser')}
            </button>
          )}

          {/* Блокировка — отдельной группой со своим заголовком: срок, код и кнопка
            относятся только к ней, а шли сплошной стопкой вместе с остальными мерами. */}
          <h3 className="card-sub">{t('complaintBlockSection')}</h3>
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
                {
                  destructive: true,
                  ok:
                    blockDays === 0
                      ? t('complaintBlockUser')
                      : t('complaintBlockUserFor', { days: blockDays }),
                },
              )
            }
          >
            {blockDays === 0
              ? t('complaintBlockUser')
              : t('complaintBlockUserFor', { days: blockDays })}
          </button>
        </section>
      )}
    </div>
  )
}
