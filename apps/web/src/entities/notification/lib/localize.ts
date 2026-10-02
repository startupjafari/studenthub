import { renderNotificationMessage } from '@studenthub/shared-config'
import type { NotificationItem } from '../model/types'

// Текст уведомления на текущем языке интерфейса.
//
// В базе лежит и готовая строка, и ключ словарной статьи с параметрами. Готовая строка
// отрисована на языке, который был у человека в момент создания уведомления, — её хватает
// push'у и письму, но не ленте: язык меняют в настройках, и вчерашние уведомления обязаны
// переключиться вместе с остальным интерфейсом, иначе лента остаётся двуязычной.
//
// Ключа нет — показываем сохранённое как есть. Так у двух групп: уведомления, созданные до
// появления словаря, и те, чей текст словарной статьи не имеет в принципе (имя отправителя,
// превью сообщения, комментарий сотрудника — пользовательский ввод, переводить нечем).
//
// Не хук: вызывается внутри map по списку, а хук в цикле — нарушение правил хуков.
// Язык компонент получает один раз через useLocale() и передаёт сюда.
export function localizeNotification(
  n: Pick<NotificationItem, 'title' | 'body' | 'titleKey' | 'bodyKey' | 'params'>,
  locale: string,
): { title: string; body: string } {
  return {
    title: (n.titleKey && renderNotificationMessage(locale, n.titleKey, n.params)) || n.title,
    body: (n.bodyKey && renderNotificationMessage(locale, n.bodyKey, n.params)) || n.body,
  }
}
