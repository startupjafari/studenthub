import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { t } from '../i18n'
import { parseMessage, type Token } from '../lib/markup'
import { openLink } from '../telegram/webapp'

/**
 * Текст сообщения — так же, как в чатах платформы.
 *
 * До этого содержимое выводилось строкой как есть: адрес читался вместе с угловыми
 * скобками markdown, `[сайт](адрес)` — вместе со скобками, переводы строк схлопывались в
 * пробел, и длинное сообщение превращалось в сплошное полотно, по которому нечем нажать.
 *
 * Разбор — в lib/markup.ts, здесь только отрисовка. Разделение не формальное: разбор
 * проверяется тестами без DOM, а отрисовке остаётся решение про ссылку — открывать её
 * средствами Telegram, а не вкладкой WebView, из которой человек обратно не вернётся.
 *
 * Спойлер (`||…||`, PROJECT.md §3.6) скрыт до касания, касание открывает все спойлеры
 * сообщения сразу — как в Telegram.
 */
export function MessageText({ content }: { content: string }) {
  const tokens = useMemo(() => parseMessage(content), [content])
  const [revealed, setRevealed] = useState(false)

  const render = (list: Token[]): ReactNode[] =>
    list.map((token, index) => {
      switch (token.kind) {
        case 'link':
          return (
            <a
              key={index}
              href={token.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                // В Telegram ссылку открывает клиент: своей вкладки у WebView мини-аппа
                // нет, и переход по `target="_blank"` уводит человека из приложения без
                // пути назад. Вне Telegram остаётся обычное поведение ссылки.
                if (openLink(token.href)) event.preventDefault()
              }}
            >
              {token.text}
            </a>
          )
        case 'code':
          return <code key={index}>{token.text}</code>
        case 'bold':
          return <b key={index}>{token.text}</b>
        case 'italic':
          return <i key={index}>{token.text}</i>
        case 'underline':
          return <u key={index}>{render(parseMessage(token.text))}</u>
        case 'spoiler':
          return revealed ? (
            <span key={index} className="msg-spoiler">
              {render(parseMessage(token.text))}
            </span>
          ) : (
            <span
              key={index}
              role="button"
              tabIndex={0}
              aria-label={t('tgMarkupSpoiler')}
              className="msg-spoiler"
              data-hidden=""
              onClick={(event) => {
                // Ссылка внутри скрытого спойлера не открывается: первое касание — открыть.
                event.preventDefault()
                event.stopPropagation()
                setRevealed(true)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                setRevealed(true)
              }}
            >
              <span aria-hidden>{render(parseMessage(token.text))}</span>
            </span>
          )
        default:
          return <Fragment key={index}>{token.text}</Fragment>
      }
    })

  return <span className="msg">{render(tokens)}</span>
}
