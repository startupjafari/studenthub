import type { StoryElementInput } from '@studenthub/shared-schemas'
import type { StoryEventCard, StoryPairCard, StoryPostCard } from '../../../entities/story'
import { localId } from '../../../shared/lib'

/**
 * Элемент в редакторе: то, что уйдёт на сервер, плюс локальный id (выбор, перетаскивание,
 * ключ списка) и имя отметки для показа на холсте — сервер хранит только userId.
 */
export type EditorElement = StoryElementInput & {
  id: string
  name?: string
  /** Превью карточки-стикера, выбранной в окне: на сервер уходит только id записи. */
  event?: StoryEventCard
  post?: StoryPostCard
  pair?: StoryPairCard
}

/** Новый элемент — в центре кадра, обычного размера, без поворота. */
const CENTER = { x: 0.5, y: 0.45, scale: 1, rotation: 0 }

export function newTextElement(text: string): EditorElement {
  return {
    id: localId(),
    type: 'text',
    ...CENTER,
    text,
    color: '#ffffff',
    font: 'sans',
    align: 'center',
    background: 'none',
  }
}

export function newEmojiElement(emoji: string): EditorElement {
  return { id: localId(), type: 'emoji', ...CENTER, y: 0.3, emoji }
}

export function newMentionElement(userId: string, name: string): EditorElement {
  return { id: localId(), type: 'mention', ...CENTER, y: 0.6, userId, name }
}

export function newEventElement(event: StoryEventCard): EditorElement {
  return { id: localId(), type: 'event', ...CENTER, y: 0.7, eventId: event.id, event }
}

export function newPostElement(post: StoryPostCard): EditorElement {
  return { id: localId(), type: 'post', ...CENTER, y: 0.7, postId: post.id, post }
}

export function newScheduleElement(pair: StoryPairCard, date: string): EditorElement {
  return { id: localId(), type: 'schedule', ...CENTER, y: 0.7, pairId: pair.id, date, pair }
}

/**
 * Элементы для запроса: без локального id, имени отметки и превью карточек — сервер
 * подставит их сам, по правам каждого зрителя.
 */
export function toStoryElements(elements: readonly EditorElement[]): StoryElementInput[] {
  return elements.map(
    ({ id: _id, name: _name, event: _event, post: _post, pair: _pair, ...element }) =>
      element as StoryElementInput,
  )
}

/** Карточки-стикеры: их на кадре не больше STORY_CARDS_MAX. */
export function isCard(element: EditorElement): boolean {
  return element.type === 'event' || element.type === 'post' || element.type === 'schedule'
}

/** Значение в пределах кадра: элемент нельзя утащить за край. */
export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
