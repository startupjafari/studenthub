import { Fragment, useMemo } from 'react'
import { parseMessage } from '../lib/markup'
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
 */
export function MessageText({ content }: { content: string }) {
  const tokens = useMemo(() => parseMessage(content), [content])

  return (
    <span className="msg">
      {tokens.map((token, index) => {
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
          default:
            return <Fragment key={index}>{token.text}</Fragment>
        }
      })}
    </span>
  )
}
