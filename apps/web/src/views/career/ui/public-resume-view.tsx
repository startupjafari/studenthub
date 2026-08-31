'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { BadgeCheck, FileQuestion } from 'lucide-react'
import { fetchPublicResume, resumeKeys, type ResumeItem } from '../../../entities/resume'
import { PageLoader, StatusScreen } from '../../../shared/ui'

/**
 * Публичное резюме по ссылке. Открывается без входа, поэтому показывает ровно то, что
 * студент опубликовал: контакты приходят с сервера пустыми, если он их не включил.
 */
export function PublicResumeView({ slug }: { slug: string }) {
  const t = useTranslations('Resume')
  const tCommon = useTranslations('Common')
  const query = useQuery({
    queryKey: resumeKeys.public(slug),
    queryFn: () => fetchPublicResume(slug),
    retry: false,
  })

  if (query.isLoading) return <PageLoader label={tCommon('loading')} />
  if (query.isError || !query.data) {
    return (
      <StatusScreen icon={FileQuestion} title={t('notFound')} description={t('notFoundHint')} />
    )
  }

  const r = query.data

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 sm:p-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">{r.fullName}</h1>
        {r.headline && <p className="text-muted-foreground">{r.headline}</p>}
        {r.contacts.length > 0 && (
          <p className="mt-1 text-sm text-muted-foreground">{r.contacts.join(' · ')}</p>
        )}
      </header>

      {r.about && (
        <Section title={t('sectionAbout')}>{<p className="text-sm">{r.about}</p>}</Section>
      )}

      {r.education.length > 0 && (
        <Section title={t('sectionEducation')}>
          <ul className="flex flex-col gap-1 text-sm">
            {r.education.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Section>
      )}

      {r.skills.length > 0 && (
        <Section title={t('sectionSkills')}>
          <ul className="flex flex-wrap gap-1.5">
            {r.skills.map((skill) => (
              <li key={skill} className="rounded bg-muted px-2 py-0.5 text-xs">
                {skill}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {r.experience.length > 0 && (
        <Section title={t('sectionExperience')}>
          <Items items={r.experience} verifiedLabel={t('verified')} />
        </Section>
      )}
      {r.projects.length > 0 && (
        <Section title={t('sectionProjects')}>
          <Items items={r.projects} verifiedLabel={t('verified')} />
        </Section>
      )}
      {r.certificates.length > 0 && (
        <Section title={t('sectionCertificates')}>
          <Items items={r.certificates} verifiedLabel={t('verified')} />
        </Section>
      )}

      {r.languages.length > 0 && (
        <Section title={t('sectionLanguages')}>
          <p className="text-sm">{r.languages.join(', ')}</p>
        </Section>
      )}

      <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
        {t('generated')}
      </footer>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="border-b border-border pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Items({ items, verifiedLabel }: { items: ResumeItem[]; verifiedLabel: string }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item, index) => (
        <li key={`${item.title}-${index}`} className="flex flex-col gap-0.5">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
            {item.title}
            {/* Подтверждение вузом — то, чего нет у обычного job-борда. */}
            {item.verified && (
              <span className="flex items-center gap-1 text-xs font-normal text-primary">
                <BadgeCheck className="size-3.5" aria-hidden />
                {verifiedLabel}
              </span>
            )}
          </p>
          {(item.organization || item.period) && (
            <p className="text-xs text-muted-foreground">
              {[item.organization, item.period].filter(Boolean).join(' · ')}
            </p>
          )}
          {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
        </li>
      ))}
    </ul>
  )
}
