import type { StoryElementInput } from '@studenthub/shared-schemas'
import { localId } from '../../../shared/lib'

/**
 * Элемент в редакторе: то, что уйдёт на сервер, плюс локальный id (выбор, перетаскивание,
 * ключ списка) и имя отметки для показа на холсте — сервер хранит только userId.
 */
export type EditorElement = StoryElementInput & { id: string; name?: string }

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

/** Элементы для запроса: без локального id и имени (имя сервер подставит сам). */
export function toStoryElements(elements: readonly EditorElement[]): StoryElementInput[] {
  return elements.map(({ id: _id, name: _name, ...element }) => element as StoryElementInput)
}

/** Значение в пределах кадра: элемент нельзя утащить за край. */
export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
