import { useCallback, useEffect, useState } from 'react'
import { fetchInvites, revokeInvite, searchPeople, type Invite, type Person } from '../api/people'
import { ApiError } from '../api/client'
import { confirmAction, haptic } from '../telegram/webapp'
import { t } from '../i18n'
import { IconChevron } from '../ui/icons'
import { SearchField } from '../ui/search-field'
import { Tabs } from '../ui/tabs'
import { ScreenHeader } from '../ui/screen-header'
import { StatePlate } from '../ui/state-plate'
import { formatShortTime, initials } from '../lib/format'
import { PersonScreen } from './person'

// Люди: найти человека и решить, оставить ли ему доступ.
//
// До этого экрана заблокировать нарушителя можно было только как решение по жалобе — то
// есть если на него кто-то пожаловался. Случаи, когда модератор видит проблему сам,
// упирались в «дойду до ноутбука».
//
// Поиск идёт на сервер по мере ввода с задержкой: список пользователей платформы велик,
// и фильтровать загруженную страницу значило бы искать среди первых двадцати.

const SEARCH_DELAY_MS = 350

type State =
  { status: 'loading' } | { status: 'ready'; items: Person[]; total: number } | { status: 'error' }

export function PeopleScreen() {
  const [query, setQuery] = useState('')
  const [onlyBlocked, setOnlyBlocked] = useState(false)
  const [state, setState] = useState<State>({ status: 'loading' })
  // Открытый человек. Список под ним не перезапрашивается: решение по доступу правит
  // ровно одну строку, и перезапрос ради неё сбросил бы позицию прокрутки.
  const [open, setOpen] = useState<Person | null>(null)

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

  if (open !== null) {
    return (
      <PersonScreen
        person={open}
        onBack={() => setOpen(null)}
        onChanged={(next) => {
          setOpen(next)
          setState((prev) =>
            prev.status === 'ready'
              ? { ...prev, items: prev.items.map((item) => (item.id === next.id ? next : item)) }
              : prev,
          )
        }}
      />
    )
  }

  return (
    <div className="screen">
      <ScreenHeader
        title={t('peopleTitle')}
        subtitle={t('peopleSubtitle')}
        tabs={
          <Tabs
            items={[
              { id: 'all', label: t('peopleAll') },
              { id: 'blocked', label: t('peopleOnlyBlocked') },
            ]}
            active={onlyBlocked ? 'blocked' : 'all'}
            onSelect={(id) => setOnlyBlocked(id === 'blocked')}
          />
        }
      />

      <SearchField value={query} onChange={setQuery} placeholder={t('peopleSearchPlaceholder')} />

      {state.status === 'error' && (
        <StatePlate title={t('peopleLoadError')} onRetry={() => void load(query, onlyBlocked)} />
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <StatePlate title={t('peopleEmpty')} />
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <section className="list">
          {state.items.map((person) => (
            <button
              type="button"
              className="row"
              key={person.id}
              onClick={() => {
                haptic.tap()
                setOpen(person)
              }}
            >
              <span className="avatar-sm" aria-hidden>
                {initials(`${person.lastName} ${person.firstName}`)}
              </span>
              <span className="row-body">
                <b>
                  {person.lastName} {person.firstName}
                </b>
                <span className="hint">{person.email}</span>
                {person.isBlocked && <span className="hint hint-danger">{t('peopleBlocked')}</span>}
              </span>
              <span className="row-chevron" aria-hidden>
                <IconChevron size={17} />
              </span>
            </button>
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
