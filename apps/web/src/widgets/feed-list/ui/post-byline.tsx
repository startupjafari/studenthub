'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Pin } from 'lucide-react'
import type { FeedPost } from '../../../entities/post'
import { ProfileLink } from '../../../entities/user'
import { Avatar, AvatarFallback, AvatarImage } from '../../../shared/ui'
import { relativeTime } from '../../../shared/lib'
import { postOrg } from '../lib/post-org'

export function initials(a: { firstName: string; lastName: string }): string {
  return `${a.lastName[0] ?? ''}${a.firstName[0] ?? ''}`.toUpperCase()
}

/**
 * Автор поста: аватар, имя и строка «роль · кому адресован · когда».
 *
 * Один блок на карточку ленты и на полный просмотр: раньше в просмотре была своя шапка
 * (меньший аватар, без роли и времени), а время и автор повторялись ещё раз в подписи над
 * текстом — один и тот же пост выглядел по-разному в двух местах. Действия справа (меню,
 * крестик, бейдж черновика) каждое место дописывает само: блок занимает всю свободную
 * ширину и сокращается многоточием, а не выталкивает их.
 */
export function PostByline({ post }: { post: FeedPost }) {
  const t = useTranslations('Feed')
  const tRoles = useTranslations('Roles')
  const locale = useLocale()

  // Дата поста — момент публикации (§3.3): отложенный пост и черновик создают раньше, чем
  // они выходят. Своему черновику и отложенному даты публикации ещё нет — у них дата создания.
  const shownAt = post.publishedAt ?? post.createdAt
  // «4 д назад» вместо «27.08, 11:15»: важен возраст поста, а не точная дата.
  // Точная — в подсказке, для тех случаев, когда она всё-таки нужна.
  const exactTime = new Date(shownAt).toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const org = postOrg(post)

  return (
    <>
      {/* Пост страницы организации говорит от её имени: логотип и название компании или
          вуза, а автор — второй строкой. Ссылка ведёт на страницу организации. */}
      {org ? (
        <Link
          href={org.href}
          className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <Avatar className="size-10">
            {org.logoUrl && <AvatarImage src={org.logoUrl} alt="" />}
            <AvatarFallback>
              <org.icon className="size-5" aria-hidden />
            </AvatarFallback>
          </Avatar>
        </Link>
      ) : (
        <ProfileLink userId={post.author.id} className="shrink-0 rounded-full">
          <Avatar className="size-10">
            {post.author.avatarUrl && <AvatarImage src={post.author.avatarUrl} alt="" />}
            <AvatarFallback>{initials(post.author)}</AvatarFallback>
          </Avatar>
        </ProfileLink>
      )}
      {/* `@container`: бейдж организации — по ширине самого блока, а не экрана. В узкой
          колонке (телефон 320px, шапка окна просмотра со стрелками и крестиком) бейдж не
          сжимается и съедал всю строку — от названия оставалась одна кавычка. Теперь он
          появляется, только когда рядом с ним названию хватает места. */}
      <div className="@container min-w-0 flex-1">
        {org ? (
          <p className="flex min-w-0 items-center gap-1.5 text-sm leading-tight font-semibold">
            <Link
              href={org.href}
              className="truncate transition-colors duration-150 hover:text-primary"
            >
              {org.name}
            </Link>
            <span className="hidden shrink-0 @[16rem]:inline-flex">{org.mark}</span>
          </p>
        ) : (
          <p className="truncate text-sm leading-tight font-semibold">
            <ProfileLink
              userId={post.author.id}
              className="transition-colors duration-150 hover:text-primary"
            >
              {post.author.lastName} {post.author.firstName}
            </ProfileLink>
          </p>
        )}
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {post.pinnedAt && (
            <Pin className="size-3 shrink-0 fill-current text-primary" aria-hidden />
          )}
          <span className="truncate">
            {org ? `${post.author.lastName} ${post.author.firstName}` : tRoles(post.author.role)} ·{' '}
            {t(`audience${post.audience}`)}
          </span>
          <span aria-hidden className="shrink-0">
            ·
          </span>
          {/* Возраст поста не переносим: «45 мин. назад» в узкой колонке ломалось. */}
          <time dateTime={shownAt} title={exactTime} className="shrink-0 whitespace-nowrap">
            {relativeTime(shownAt, locale)}
          </time>
        </p>
      </div>
    </>
  )
}
