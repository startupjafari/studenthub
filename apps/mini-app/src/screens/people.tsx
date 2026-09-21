import { useCallback, useEffect, useState } from 'react'
import {
  fetchInvites,
  revokeInvite,
  revokeSessions,
  searchPeople,
  setBlocked,
  type Invite,
  type Person,
} from '../api/people'
import { ApiError } from '../api/client'
import { confirmAction, haptic } from '../telegram/webapp'
import { t } from '../i18n'
import { formatShortTime } from '../lib/format'

// Люди: найти человека и решить, оставить ли ему доступ.
//
// До этого экрана заблокировать нарушителя можно было только как решение по жалобе — то
// есть если на него кто-то пожаловался. Случаи, когда модератор видит проблему сам,
// упирались в «дойду до ноутбука».
//
// Поиск идёт на сервер по мере ввода с задержкой: список пользователей платформы велик,
// и фильтровать загруженную страницу значило бы искать среди первых двадцати.

const SEARCH_DELAY_MS = 350

// Сроки блокировки — те же три, что на карточке жалобы: 0 — бессрочно.
const BLOCK_TERMS = [
  { days: 0, key: 'blockForever' },
  { days: 7, key: 'blockWeek' },
  { days: 30, key: 'blockMonth' },
] as const

type State =
  { status: 'loading' } | { status: 'ready'; items: Person[]; total: number } | { status: 'error' }

export function PeopleScreen() {
  const [query, setQuery] = useState('')
  const [onlyBlocked, setOnlyBlocked] = useState(false)
  const [state, setState] = useState<State>({ status: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Код 2FA для блокировки: одно поле на экран, а не на каждую строку — иначе список
  // превращается в форму. Срок — рядом с ним и по той же причине.
  const [code, setCode] = useState('')
  const [blockDays, setBlockDays] = useState(0)

  const load = useCallback(async (search: string, blocked: boolean) => {
    setState({ status: 'loading' })
    try {
      const page = await searchPeople(search, blocked ? true : undefined)
      setState({ status: 'ready', items: page.items, total: page.total })
    } catch {
      setState({ status: 'error' })
    }
  }, [])

  // Задержка перед запросом: без неё каждая буква уходит в сеть, а на телефоне это
  // ещё и пятнадцать ответов, которые приходят вперемешку.
  useEffect(() => {
    const timer = setTimeout(() => void load(query, onlyBlocked), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [query, onlyBlocked, load])

  const toggleAccess = useCallback(
    async (person: Person) => {
      const name = `${person.lastName} ${person.firstName}`
      const question = person.isBlocked
        ? t('peopleConfirmUnblock', { name })
        : blockDays === 0
          ? t('peopleConfirmBlock', { name })
          : t('peopleConfirmBlockFor', { name, days: blockDays })
      if (!(await confirmAction(question))) return

      setBusy(person.id)
      setError(null)
      try {
        await setBlocked(
          person.id,
          !person.isBlocked,
          person.isBlocked ? undefined : code,
          person.isBlocked || blockDays === 0 ? undefined : blockDays,
        )
        haptic.success()
        // Правим строку на месте, а не перезапрашиваем список: при включённом фильтре
        // «только заблокированные» разблокированный человек иначе исчезал бы под пальцем,
        // не успев показать, что действие сработало.
        setState((prev) =>
          prev.status === 'ready'
            ? {
                ...prev,
                items: prev.items.map((item) =>
                  item.id === person.id ? { ...item, isBlocked: !item.isBlocked } : item,
                ),
              }
            : prev,
        )
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('peopleActionError'))
      } finally {
        setBusy(null)
      }
    },
    [blockDays, code],
  )

  const endSessions = useCallback(async (person: Person) => {
    const name = `${person.lastName} ${person.firstName}`
    if (!(await confirmAction(t('peopleConfirmLogout', { name })))) return
    setBusy(person.id)
    setError(null)
    try {
      await revokeSessions(person.id)
      haptic.success()
      setError(t('peopleLoggedOut'))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('peopleActionError'))
    } finally {
      setBusy(null)
    }
  }, [])

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>{t('peopleTitle')}</h1>
        <p className="hint">{t('peopleSubtitle')}</p>
      </header>

      <input
        className="field"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('peopleSearchPlaceholder')}
        aria-label={t('peopleSearchPlaceholder')}
        autoCapitalize="off"
        autoCorrect="off"
      />

      <div className="chips">
        <button
          type="button"
          className="chip"
          aria-pressed={!onlyBlocked}
          onClick={() => {
            haptic.select()
            setOnlyBlocked(false)
          }}
        >
          {t('peopleAll')}
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={onlyBlocked}
          onClick={() => {
            haptic.select()
            setOnlyBlocked(true)
          }}
        >
          {t('peopleOnlyBlocked')}
        </button>
      </div>

      {/* Код спрашивается один раз на экран: блокировка с телефона не должна быть
          возможна промахом, но и вводить его на каждую строку невыносимо. */}
      <input
        className="field"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder={t('confirmCodeLabel')}
        aria-label={t('confirmCodeLabel')}
        value={code}
        onChange={(event) => setCode(event.target.value.trim())}
      />
      <p className="hint">{t('confirmCodeNeeded')}</p>

      {/* Срок блокировки. Разблокировки он не касается: вернуть доступ можно только сразу. */}
      <div className="chips-grid">
        {BLOCK_TERMS.map((term) => (
          <button
            key={term.days}
            type="button"
            className="chip"
            aria-pressed={blockDays === term.days}
            onClick={() => {
              haptic.select()
              setBlockDays(term.days)
            }}
          >
            {t(term.key)}
          </button>
        ))}
      </div>

      {error && (
        <section className="card">
          <p className="hint-danger">{error}</p>
        </section>
      )}

      {state.status === 'error' && (
        <section className="card">
          <p>{t('peopleLoadError')}</p>
          <button
            type="button"
            className="fallback-submit"
            onClick={() => void load(query, onlyBlocked)}
          >
            {t('retry')}
          </button>
        </section>
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <section className="card">
          <p className="hint">{t('peopleEmpty')}</p>
        </section>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <section className="list">
          {state.items.map((person) => (
            <div className="toggle-row" key={person.id}>
              <span className="row-body">
                <b>
                  {person.lastName} {person.firstName}
                </b>
                <span className="hint">{person.email}</span>
                {person.isBlocked && <span className="hint hint-danger">{t('peopleBlocked')}</span>}
              </span>
              <span className="chips">
                {/* Сброс сессий выгоняет чужого, оставляя доступ хозяину: блокировка
                    в случае угнанного аккаунта наказала бы пострадавшего. */}
                <button
                  type="button"
                  className="chip"
                  disabled={busy === person.id}
                  onClick={() => void endSessions(person)}
                >
                  {t('peopleLogout')}
                </button>
                <button
                  type="button"
                  className={person.isBlocked ? 'chip' : 'chip danger-chip'}
                  disabled={busy === person.id}
                  onClick={() => void toggleAccess(person)}
                >
                  {person.isBlocked ? t('peopleUnblock') : t('peopleBlock')}
                </button>
              </span>
            </div>
          ))}
        </section>
      )}

      <InvitesCard />
    </div>
  )
}

/**
 * Свои приглашения. Выдачи здесь нет намеренно — она требует ввода почты и выбора scope,
 * то есть клавиатуры и стола. А вот отозвать ошибочно выданное нужно быстро: иначе
 * приглашение живёт до истечения срока и всё это время им можно воспользоваться.
 */
function InvitesCard() {
  const [invites, setInvites] = useState<Invite[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const page = await fetchInvites()
      setInvites(page.items.filter((invite) => invite.status === 'PENDING'))
    } catch {
      setInvites([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (invites === null) return null

  return (
    <section className="card">
      <h2>{t('invitesTitle')}</h2>
      {error && <p className="hint-danger">{error}</p>}
      {invites.length === 0 && <p className="hint">{t('invitesEmpty')}</p>}
      <div className="list">
        {invites.map((invite) => (
          <div className="toggle-row" key={invite.id}>
            <span className="row-body">
              <b>{invite.email ?? t('invitesNoEmail')}</b>
              <span className="hint">
                {t('invitesPending')} ·{' '}
                {t('invitesExpires', { date: formatShortTime(invite.expiresAt) })}
              </span>
            </span>
            <button
              type="button"
              className="chip danger-chip"
              onClick={async () => {
                const email = invite.email ?? t('invitesNoEmail')
                if (!(await confirmAction(t('invitesRevokeConfirm', { email })))) return
                try {
                  await revokeInvite(invite.id)
                  haptic.success()
                  setInvites((prev) => (prev ?? []).filter((item) => item.id !== invite.id))
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : t('invitesRevokeError'))
                }
              }}
            >
              {t('invitesRevoke')}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
