import Foundation

/// Перевод сообщений валидации API (PROJECT.md §8.1, «Сообщения валидации»).
///
/// Схемы сервера отдают в `details[].message` ответа `422 VALIDATION_ERROR` не текст, а
/// ключ — `validation.password.tooShort`: человек на казахском и английском должен видеть
/// ошибку на своём языке, а русская строка с сервера туда не годится. Здесь ключ
/// становится строкой каталога. Незнакомый ключ — новая версия сервера раньше новой
/// сборки — и обычный текст `nil`: экран покажет сообщение сервера как есть.
///
/// Список ключей — реестр `VALIDATION_MESSAGE_KEYS` в `packages/shared-schemas`;
/// сверку держит `ValidationMessageTests`. Числа в текстах — из констант схем
/// (`FORM_DATA_MAX_FIELDS`, `MINI_LINK_CODE_LENGTH`).
enum ValidationMessage {
    static func text(for key: String) -> String? {
        switch key {
        case "validation.auth.identifierRequired": return String(localized: "validation.auth.identifierRequired", defaultValue: "Введите email или имя пользователя")
        case "validation.auth.passwordRequired": return String(localized: "validation.auth.passwordRequired", defaultValue: "Введите пароль")
        case "validation.username.invalid": return String(localized: "validation.username.invalid", defaultValue: "Только латиница, цифры и _, 3–32 символа")
        case "validation.password.tooShort": return String(localized: "validation.password.tooShort", defaultValue: "Минимум 8 символов")
        case "validation.password.letterRequired": return String(localized: "validation.password.letterRequired", defaultValue: "Нужна хотя бы одна буква")
        case "validation.password.digitRequired": return String(localized: "validation.password.digitRequired", defaultValue: "Нужна хотя бы одна цифра")
        case "validation.password.specialRequired": return String(localized: "validation.password.specialRequired", defaultValue: "Нужен хотя бы один спецсимвол")
        case "validation.password.tooLong": return String(localized: "validation.password.tooLong", defaultValue: "Слишком длинный пароль: не больше 72 байт (около 36 букв кириллицей)")
        case "validation.twoFactor.codeFormat": return String(localized: "validation.twoFactor.codeFormat", defaultValue: "Код из 6 цифр")
        case "validation.birthDate.implausible": return String(localized: "validation.birthDate.implausible", defaultValue: "Проверьте дату рождения")
        case "validation.consent.guardianRequired": return String(localized: "validation.consent.guardianRequired", defaultValue: "Нужно согласие законного представителя")
        case "validation.consent.required": return String(localized: "validation.consent.required", defaultValue: "Требуется согласие")
        case "validation.onboarding.stepNotSkippable": return String(localized: "validation.onboarding.stepNotSkippable", defaultValue: "Этот шаг нельзя пропустить")
        case "validation.date.format": return String(localized: "validation.date.format", defaultValue: "Дата в формате ГГГГ-ММ-ДД")
        case "validation.date.invalid": return String(localized: "validation.date.invalid", defaultValue: "Такой даты нет")
        case "validation.time.format": return String(localized: "validation.time.format", defaultValue: "Время в формате ЧЧ:ММ (00:00–23:59)")
        case "validation.range.endAfterStart": return String(localized: "validation.range.endAfterStart", defaultValue: "Окончание должно быть позже начала")
        case "validation.range.endNotBeforeStart": return String(localized: "validation.range.endNotBeforeStart", defaultValue: "Окончание не может быть раньше начала")
        case "validation.range.startBeforeEnd": return String(localized: "validation.range.startBeforeEnd", defaultValue: "Время начала должно быть раньше времени окончания")
        case "validation.range.bothBounds": return String(localized: "validation.range.bothBounds", defaultValue: "Период задаётся обеими границами")
        case "validation.range.tooLong": return String(localized: "validation.range.tooLong", defaultValue: "Период длиннее допустимого для этого шага")
        case "validation.timeZone.unknown": return String(localized: "validation.timeZone.unknown", defaultValue: "Неизвестный часовой пояс")
        case "validation.common.nothingToChange": return String(localized: "validation.common.nothingToChange", defaultValue: "Нечего менять")
        case "validation.common.duplicateIds": return String(localized: "validation.common.duplicateIds", defaultValue: "Идентификаторы повторяются")
        case "validation.common.reasonRequired": return String(localized: "validation.common.reasonRequired", defaultValue: "Укажите причину")
        case "validation.common.rejectionReasonRequired": return String(localized: "validation.common.rejectionReasonRequired", defaultValue: "Укажите причину отказа")
        case "validation.common.textOrAttachment": return String(localized: "validation.common.textOrAttachment", defaultValue: "Нужен текст или вложение")
        case "validation.common.pageLimit": return String(localized: "validation.common.pageLimit", defaultValue: "При постраничной выдаче — не больше 100 записей")
        case "validation.url.httpOnly": return String(localized: "validation.url.httpOnly", defaultValue: "Ссылка должна быть http или https")
        case "validation.url.website": return String(localized: "validation.url.website", defaultValue: "Укажите адрес сайта, например example.kz")
        case "validation.phone.format": return String(localized: "validation.phone.format", defaultValue: "Номер в формате +7 (777) 777-77-77")
        case "validation.version.format": return String(localized: "validation.version.format", defaultValue: "Версия в формате 1.2.3")
        case "validation.upload.partRangeReversed": return String(localized: "validation.upload.partRangeReversed", defaultValue: "Конец диапазона частей не может быть меньше начала")
        case "validation.security.documentLast4": return String(localized: "validation.security.documentLast4", defaultValue: "Четыре последние цифры документа")
        case "validation.security.documentTypeRequired": return String(localized: "validation.security.documentTypeRequired", defaultValue: "Укажите тип документа")
        case "validation.kato.code": return String(localized: "validation.kato.code", defaultValue: "Код КАТО — 9 цифр")
        case "validation.mini.linkCodeLength": return String(localized: "validation.mini.linkCodeLength", defaultValue: "Код привязки — 8 символов")
        case "validation.support.textTooShort": return String(localized: "validation.support.textTooShort", defaultValue: "Опишите вопрос подробнее")
        case "validation.stories.duplicateRecipients": return String(localized: "validation.stories.duplicateRecipients", defaultValue: "Получатели повторяются")
        case "validation.stories.recipientsOnlyForSelected": return String(localized: "validation.stories.recipientsOnlyForSelected", defaultValue: "Получатели указываются только для аудитории «выбранные»")
        case "validation.stories.duplicatePollOptions": return String(localized: "validation.stories.duplicatePollOptions", defaultValue: "Варианты ответа не должны повторяться")
        case "validation.stories.tooManyMentions": return String(localized: "validation.stories.tooManyMentions", defaultValue: "Слишком много упоминаний")
        case "validation.stories.tooManyCards": return String(localized: "validation.stories.tooManyCards", defaultValue: "Слишком много карточек")
        case "validation.stories.empty": return String(localized: "validation.stories.empty", defaultValue: "Сторис должна содержать медиа или текст")
        case "validation.stories.backgroundTextOnly": return String(localized: "validation.stories.backgroundTextOnly", defaultValue: "Фон выбирается только для текстовой сторис")
        case "validation.stories.linkLabelWithoutUrl": return String(localized: "validation.stories.linkLabelWithoutUrl", defaultValue: "Подпись без ссылки")
        case "validation.chats.nothingToChange": return String(localized: "validation.chats.nothingToChange", defaultValue: "Нечего менять: укажите название или описание")
        case "validation.chats.emptyMessage": return String(localized: "validation.chats.emptyMessage", defaultValue: "Сообщение не может быть пустым")
        case "validation.chats.privateOneMember": return String(localized: "validation.chats.privateOneMember", defaultValue: "Личный чат создаётся ровно с одним собеседником")
        case "validation.chats.spoilerIndexes": return String(localized: "validation.chats.spoilerIndexes", defaultValue: "Ожидались номера вложений через запятую")
        case "validation.chats.quoteWithoutReply": return String(localized: "validation.chats.quoteWithoutReply", defaultValue: "Цитата возможна только вместе с ответом на сообщение")
        case "validation.chats.scheduleInPast": return String(localized: "validation.chats.scheduleInPast", defaultValue: "Время отправки должно быть в будущем")
        case "validation.chats.scheduleTooFar": return String(localized: "validation.chats.scheduleTooFar", defaultValue: "Отложить можно не больше чем на год")
        case "validation.chats.reactionEmoji": return String(localized: "validation.chats.reactionEmoji", defaultValue: "Реакция — один эмодзи")
        case "validation.chats.folderEmoji": return String(localized: "validation.chats.folderEmoji", defaultValue: "Значок папки — один эмодзи")
        case "validation.chats.folderChatExcluded": return String(localized: "validation.chats.folderChatExcluded", defaultValue: "Чат не может быть одновременно в папке и в исключениях")
        case "validation.chats.contactEmpty": return String(localized: "validation.chats.contactEmpty", defaultValue: "Укажите хотя бы один телефон или адрес почты")
        case "validation.chats.stickerSlug": return String(localized: "validation.chats.stickerSlug", defaultValue: "Короткое имя: латиница, цифры, «-» и «_», от 2 до 64 знаков")
        case "validation.chats.livePeriod": return String(localized: "validation.chats.livePeriod", defaultValue: "Трансляция: 15 минут, 1 час или 8 часов")
        case "validation.documents.typeCode": return String(localized: "validation.documents.typeCode", defaultValue: "Код: заглавные латинские, цифры, подчёркивание")
        case "validation.library.isbn": return String(localized: "validation.library.isbn", defaultValue: "ISBN — 10 или 13 цифр")
        case "validation.library.copiesOrCount": return String(localized: "validation.library.copiesOrCount", defaultValue: "Укажите инвентарные номера или количество")
        case "validation.library.copyRefRequired": return String(localized: "validation.library.copyRefRequired", defaultValue: "Укажите код наклейки или инвентарный номер")
        case "validation.library.popularPeriod": return String(localized: "validation.library.popularPeriod", defaultValue: "Период: 30, 90 или 365 дней")
        case "validation.applications.tooManyFields": return String(localized: "validation.applications.tooManyFields", defaultValue: "Не больше 100 полей")
        case "validation.applications.fileOrDocument": return String(localized: "validation.applications.fileOrDocument", defaultValue: "Укажите либо файл, либо существующий документ")
        case "validation.applications.documentTypeRequired": return String(localized: "validation.applications.documentTypeRequired", defaultValue: "Укажите вид документа")
        case "validation.applications.catalogCode": return String(localized: "validation.applications.catalogCode", defaultValue: "Латиница, цифры и дефис, от 2 до 60 символов")
        case "validation.applications.choiceOptionsRequired": return String(localized: "validation.applications.choiceOptionsRequired", defaultValue: "У поля выбора нужен хотя бы один вариант")
        case "validation.applications.duplicateDeliveryMode": return String(localized: "validation.applications.duplicateDeliveryMode", defaultValue: "Способ выдачи указан дважды")
        case "validation.applications.duplicateRequirementCodes": return String(localized: "validation.applications.duplicateRequirementCodes", defaultValue: "Коды документов должны быть разными")
        case "validation.applications.duplicateFieldCodes": return String(localized: "validation.applications.duplicateFieldCodes", defaultValue: "Коды полей должны быть разными")
        case "validation.org.foundedYearFuture": return String(localized: "validation.org.foundedYearFuture", defaultValue: "Год из будущего")
        case "validation.org.telegram": return String(localized: "validation.org.telegram", defaultValue: "@имя или https://t.me/имя")
        case "validation.org.instagram": return String(localized: "validation.org.instagram", defaultValue: "Ссылка вида https://instagram.com/имя")
        case "validation.org.linkedin": return String(localized: "validation.org.linkedin", defaultValue: "Ссылка вида https://linkedin.com/company/имя")
        case "validation.cameras.rtspScheme": return String(localized: "validation.cameras.rtspScheme", defaultValue: "Адрес должен начинаться с rtsp://")
        case "validation.cameras.credentialsInUrl": return String(localized: "validation.cameras.credentialsInUrl", defaultValue: "Логин и пароль укажите в отдельных полях, а не в адресе")
        case "validation.cameras.hostMissing": return String(localized: "validation.cameras.hostMissing", defaultValue: "В адресе нет хоста камеры")
        case "validation.career.slug": return String(localized: "validation.career.slug", defaultValue: "Только строчная латиница, цифры и дефис")
        case "validation.schedule.newRoomRequired": return String(localized: "validation.schedule.newRoomRequired", defaultValue: "Нужна новая аудитория")
        case "validation.schedule.substituteRequired": return String(localized: "validation.schedule.substituteRequired", defaultValue: "Нужен заменяющий преподаватель")
        case "validation.schedule.newStartRequired": return String(localized: "validation.schedule.newStartRequired", defaultValue: "Нужно новое время начала")
        case "validation.schedule.newEndRequired": return String(localized: "validation.schedule.newEndRequired", defaultValue: "Нужно новое время окончания")
        default: return nil
        }
    }
}

extension APIErrorDetail {
    /// Текст ошибки поля для человека: перевод ключа валидации, иначе как прислал сервер.
    var displayMessage: String {
        ValidationMessage.text(for: message) ?? message
    }
}
