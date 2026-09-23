import { useEffect, useState } from 'react'
import { fetchPersonCard, type PersonCard } from '../api/people'
import { t, type MessageKey } from '../i18n'
import { formatDateTime, formatDay } from '../lib/format'

// Кто этот человек — рядом с жалобой и рядом с обращением.
//
// До неё в обоих местах было только имя. Жалоба на «Иванова» и вопрос от «Иванова»
// разбираются по-разному в зависимости от того, студент он первого курса или декан,
// заблокирован ли уже и попадался ли раньше — а посмотреть это можно было только в вебе.
//
// Блок вспомогательный: если карточка не пришла, решение по жалобе всё равно принимается,
// поэтому отказ гасится в одну строку и экран не ломает.

const ROLE_KEY: Record<string, MessageKey> = {
  STUDENT: 'personRoleStudent',
  STAROSTA: 'personRoleStarosta',
  TEACHER: 'personRoleTeacher',
  DEAN: 'personRoleDean',
  UNIVERSITY_ADMIN: 'personRoleUniAdmin',
  UNIVERSITY_MODERATOR: 'personRoleUniModerator',
  PLATFORM_ADMIN: 'personRolePlatformAdmin',
  PLATFORM_MODERATOR: 'personRolePlatformModerator',
}

export function PersonSummary({ userId, title }: { userId: string; title: string }) {
  const [card, setCard] = useState<PersonCard | 'error' | null>(null)

  useEffect(() => {
    let alive = true
    setCard(null)
    fetchPersonCard(userId)
      .then((loaded) => {
        if (alive) setCard(loaded)
      })
      .catch(() => {
        if (alive) setCard('error')
      })
    return () => {
      alive = false
    }
  }, [userId])

  if (card === null) return null

  if (card === 'error') {
    return (
      <section className="card">
        <h2>{title}</h2>
        <p className="hint">{t('personCardError')}</p>
      </section>
    )
  }

  const roleKey = ROLE_KEY[card.role]

  return (
    <section className="card">
      <h2>{title}</h2>
      <p>
        <b>
          {card.lastName} {card.firstName}
        </b>
      </p>
      <p className="hint">
        {roleKey ? t(roleKey) : card.role}
        {card.university ? ` · ${card.university.name}` : ''}
      </p>
      <p className="hint">{t('personSince', { when: formatDay(card.createdAt) })}</p>
      {card.isBlocked && (
        <p className="hint hint-danger">
          {/* Срок важнее самого факта: «до завтра» и «навсегда» — разные решения,
              и повторно блокировать человека, который и так отключён до среды, незачем. */}
          {card.blockedUntil
            ? t('personBlockedUntil', { when: formatDateTime(card.blockedUntil) })
            : t('personBlocked')}
        </p>
      )}
      {card.warnings > 0 && <p className="hint">{t('personWarnings', { count: card.warnings })}</p>}
      {/* «Впервые или снова» — то, чего не видно ни в тексте жалобы, ни в вопросе.
          Счётчик считает жалобы на самого человека: так отвечает сервер, и обещать
          больше, чем он считает, значило бы врать в самом чувствительном месте. */}
      {card.complaints.total === 0 ? (
        <p className="hint">{t('personFirstTime')}</p>
      ) : (
        <p className={card.complaints.upheld > 0 ? 'hint hint-danger' : 'hint'}>
          {t('personComplaints', {
            count: card.complaints.total,
            upheld: card.complaints.upheld,
          })}
        </p>
      )}
    </section>
  )
}
