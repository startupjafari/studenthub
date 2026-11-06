import type { ComponentPropsWithoutRef } from 'react'
import { isTrustedImageUrl } from '../lib/trusted-image'

type Props = ComponentPropsWithoutRef<'img'> & { node?: unknown }

/**
 * `img` для react-markdown: свои картинки рисуются как есть, внешние — ссылкой. Иначе
 * картинка из чужого markdown загружалась у каждого читателя сама (см. isTrustedImageUrl).
 */
export function MarkdownImage({ node: _node, src, alt, ...rest }: Props) {
  const href = typeof src === 'string' ? src : undefined
  if (isTrustedImageUrl(href)) return <img src={href} alt={alt ?? ''} {...rest} />
  if (!href) return null
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {alt || href}
    </a>
  )
}
