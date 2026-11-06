/**
 * Сообщения валидации — коды-ключи, а не текст (PROJECT.md §8.1, «Сообщения валидации»).
 *
 * Схемы общие для API и форм веба, а читают ошибку люди на трёх языках. Русская строка в
 * схеме доезжала до казахского и английского интерфейса как есть — и через `zodResolver` в
 * форме, и через `details[].message` в ответе `422 VALIDATION_ERROR` в приложениях. Поэтому
 * схема говорит ключ (`validation.password.tooShort`), а текст подставляет клиент:
 * веб — из словаря `Validation` (`apps/web/messages/*.json`), iOS и Android — из своих
 * строковых ресурсов. Незнакомый ключ клиент показывает как есть: старая сборка увидит
 * новый ключ раньше, чем обновится.
 *
 * Новое сообщение: ключ сюда, затем перевод во все три словаря веба (страж —
 * `apps/web/src/shared/i18n/validation-messages.test.ts`) и в строки клиентов.
 * Сообщение с числом из константы — значение подстановки в `VALIDATION_MESSAGE_VALUES`.
 */
export const VALIDATION_MESSAGE_KEYS = [
  // Вход, логин, пароль, 2FA
  'validation.auth.identifierRequired',
  'validation.auth.passwordRequired',
  'validation.username.invalid',
  'validation.password.tooShort',
  'validation.password.letterRequired',
  'validation.password.digitRequired',
  'validation.password.specialRequired',
  'validation.password.tooLong',
  'validation.twoFactor.codeFormat',
  // Дата рождения и согласия
  'validation.birthDate.implausible',
  'validation.consent.guardianRequired',
  'validation.consent.required',
  'validation.onboarding.stepNotSkippable',
  // Даты, время, периоды
  'validation.date.format',
  'validation.date.invalid',
  'validation.time.format',
  'validation.range.endAfterStart',
  'validation.range.endNotBeforeStart',
  'validation.range.startBeforeEnd',
  'validation.range.bothBounds',
  'validation.range.tooLong',
  'validation.timeZone.unknown',
  // Общее
  'validation.common.nothingToChange',
  'validation.common.duplicateIds',
  'validation.common.reasonRequired',
  'validation.common.rejectionReasonRequired',
  'validation.common.textOrAttachment',
  'validation.common.pageLimit',
  'validation.url.httpOnly',
  'validation.url.website',
  'validation.phone.format',
  'validation.version.format',
  'validation.upload.partRangeReversed',
  // Охрана, справочники, мини-апп, поддержка
  'validation.security.documentLast4',
  'validation.security.documentTypeRequired',
  'validation.kato.code',
  'validation.mini.linkCodeLength',
  'validation.support.textTooShort',
  // Сторис
  'validation.stories.duplicateRecipients',
  'validation.stories.recipientsOnlyForSelected',
  'validation.stories.duplicatePollOptions',
  'validation.stories.tooManyMentions',
  'validation.stories.tooManyCards',
  'validation.stories.empty',
  'validation.stories.backgroundTextOnly',
  'validation.stories.linkLabelWithoutUrl',
  // Чаты
  'validation.chats.nothingToChange',
  'validation.chats.emptyMessage',
  'validation.chats.privateOneMember',
  'validation.chats.spoilerIndexes',
  'validation.chats.quoteWithoutReply',
  'validation.chats.scheduleInPast',
  'validation.chats.scheduleTooFar',
  // Документы, библиотека
  'validation.documents.typeCode',
  'validation.library.isbn',
  'validation.library.copiesOrCount',
  'validation.library.copyRefRequired',
  'validation.library.popularPeriod',
  // Каталог услуг (заявки)
  'validation.applications.tooManyFields',
  'validation.applications.fileOrDocument',
  'validation.applications.documentTypeRequired',
  'validation.applications.catalogCode',
  'validation.applications.choiceOptionsRequired',
  'validation.applications.duplicateDeliveryMode',
  'validation.applications.duplicateRequirementCodes',
  'validation.applications.duplicateFieldCodes',
  // Страница организации
  'validation.org.foundedYearFuture',
  'validation.org.telegram',
  'validation.org.instagram',
  'validation.org.linkedin',
  // Камеры, карьера, расписание
  'validation.cameras.rtspScheme',
  'validation.cameras.credentialsInUrl',
  'validation.cameras.hostMissing',
  'validation.career.slug',
  'validation.schedule.newRoomRequired',
  'validation.schedule.substituteRequired',
  'validation.schedule.newStartRequired',
  'validation.schedule.newEndRequired',
] as const

export type ValidationMessageKey = (typeof VALIDATION_MESSAGE_KEYS)[number]

/** Общий префикс ключей: по нему клиент отличает ключ от готового текста. */
export const VALIDATION_MESSAGE_PREFIX = 'validation.'

/**
 * Ключ сообщения для схемы. Тождественная функция ради проверки типов: опечатка в ключе —
 * ошибка компиляции, а не сырой ключ на экране.
 */
export function vm(key: ValidationMessageKey): ValidationMessageKey {
  return key
}

/** Похожа ли строка на ключ сообщения валидации (а не на готовый текст). */
export function isValidationMessageKey(value: string): value is ValidationMessageKey {
  return (VALIDATION_MESSAGE_KEYS as readonly string[]).includes(value)
}
