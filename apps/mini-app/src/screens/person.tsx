import { useCallback, useState } from 'react'
import { revokeSessions, setBlocked, type Person } from '../api/people'
import { ApiError } from '../api/client'
import { confirmAction, haptic } from '../telegram/webapp'
import { useBackButton } from '../telegram/use-telegram'
import { t } from '../i18n'
import { ScreenHeader } from '../ui/screen-header'
import { PersonSummary } from './person-summary'

/**
 * Страница человека: кто он и что с его доступом делать.
 *
 * Раньше всё это жило в строке списка: две кнопки действий прямо в строке, а поле кода
 * 2FA и сроки блокировки — над списком, один набор на всех сразу. Список из-за этого был
 * формой, кнопки наезжали на имена, а введённый срок относился неизвестно к кому — он же
 * общий. Решение о доступе принимается ПО ЧЕЛОВЕКУ, значит и приниматься должно на его
 * странице, где видно, кто он и попадался ли раньше.
 *
 * `person` приходит строкой списка, а не догружается: имя и состояние доступа уже
 * известны, и заставлять смотреть на скелетон ради того, что было на экране секунду
 * назад, незачем. Подробности догружает карточка (`PersonSummary`).
 */

// Сроки блокировки — те же три, что на карточке жалобы: 0 — бессрочно.
const BLOCK_TERMS = [
  { days: 0, key: 'blockForever' },
  { days: 7, key: 'blockWeek' },
  { days: 30, key: 'blockMonth' },
] as const

export function PersonScreen({
  person,
  onBack,
  onChanged,
}: {
  person: Person
  onBack: () => void
  onChanged: (next: Person) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [blockDays, setBlockDays] = useState(0)

  useBackButton(onBack)

  const name = `${person.lastName} ${person.firstName}`

  const toggleAccess = useCallback(async () => {
    const question = person.isBlocked
      ? t('peopleConfirmUnblock', { name })
      : blockDays === 0
        ? t('peopleConfirmBlock', { name })
        : t('peopleConfirmBlockFor', { name, days: blockDays })
    if (!(await confirmAction(question))) return

    setBusy(true)
    setError(null)
    setNote(null)
    try {
      await setBlocked(
        person.id,
        !person.isBlocked,
        person.isBlocked ? undefined : code,
        person.isBlocked || blockDays === 0 ? undefined : blockDays,
      )
      haptic.success()
      // Строка списка правится на месте: при фильтре «только заблокированные»
      // перезапрос убрал бы человека с глаз раньше, чем стало видно, что вышло.
      onChanged({ ...person, isBlocked: !person.isBlocked })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('peopleActionError'))
    } finally {
      setBusy(false)
    }
  }, [person, name, code, blockDays, onChanged])

  const endSessions = useCallback(async () => {
    if (!(await confirmAction(t('peopleConfirmLogout', { name })))) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      await revokeSessions(person.id)
      haptic.success()
      setNote(t('peopleLoggedOut'))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('peopleActionError'))
    } finally {
      setBusy(false)
    }
  }, [person.id, name])

  return (
    <div className="screen">
      <ScreenHeader title={name} subtitle={person.email} onBack={onBack} />

      <PersonSummary userId={person.id} title={t('peopleCardTitle')} />

      <section className="card">
        <h2>{t('peopleAccessTitle')}</h2>

        {/* Код и срок нужны только для блокировки. Разблокировке ни того, ни другого не
            требуется: вернуть доступ должно быть возможно сразу и без вопросов. */}
        {!person.isBlocked && (
          <>
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
          </>
        )}

        {error && <p className="hint-danger">{error}</p>}
        {note && <p className="hint">{note}</p>}

        <button
          type="button"
          className={person.isBlocked ? 'fallback-submit' : 'fallback-submit danger'}
          disabled={busy}
          onClick={() => void toggleAccess()}
        >
          {person.isBlocked ? t('peopleUnblock') : t('peopleBlock')}
        </button>

        {/* Сброс сессий выгоняет чужого, оставляя доступ хозяину: блокировка в случае
            угнанного аккаунта наказала бы пострадавшего. Тише блокировки: это ответ на
            «аккаунт увели», а не решение о человеке. */}
        <button
          type="button"
          className="fallback-submit plain"
          disabled={busy}
          onClick={() => void endSessions()}
        >
          {t('peopleLogout')}
        </button>
      </section>
    </div>
  )
}
