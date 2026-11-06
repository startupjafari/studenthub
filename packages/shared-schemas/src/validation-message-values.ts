import { FORM_DATA_MAX_FIELDS } from './application-services.js'
import { MINI_LINK_CODE_LENGTH } from './mini.js'
import type { ValidationMessageKey } from './validation-messages.js'

/**
 * Подстановки в текст сообщений валидации: число берётся из той же константы, что и
 * правило схемы, поэтому текст не разойдётся с проверкой. Отдельным файлом от реестра
 * ключей: схемы импортируют реестр, а этот файл — схемы, и цикла не возникает.
 */
export const VALIDATION_MESSAGE_VALUES: Partial<
  Record<ValidationMessageKey, Record<string, number>>
> = {
  'validation.applications.tooManyFields': { max: FORM_DATA_MAX_FIELDS },
  'validation.mini.linkCodeLength': { length: MINI_LINK_CODE_LENGTH },
}
