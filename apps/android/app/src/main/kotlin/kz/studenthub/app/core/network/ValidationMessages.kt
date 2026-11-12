package kz.studenthub.app.core.network

import androidx.annotation.StringRes
import kz.studenthub.app.R
import kz.studenthub.app.core.ui.UiText

/**
 * Сообщения валидации API (PROJECT.md §8.1, «Сообщения валидации»).
 *
 * Схемы сервера отдают в `details[].message` ответа `422 VALIDATION_ERROR` не текст, а ключ —
 * `validation.password.tooShort`. Здесь ключ становится строкой ресурсов на языке приложения
 * (строки общие с iOS, `strings_ios.xml`). Незнакомый ключ — сервер новее сборки — и обычный
 * текст дают `null`: решает вызывающий, показать ли его как есть.
 *
 * Список ключей — реестр `VALIDATION_MESSAGE_KEYS` в `packages/shared-schemas`; сверку
 * держит `ValidationMessagesTest`.
 */
object ValidationMessages {
    private val byKey: Map<String, Int> = mapOf(
        "validation.auth.identifierRequired" to R.string.validation_auth_identifierRequired,
        "validation.auth.passwordRequired" to R.string.validation_auth_passwordRequired,
        "validation.username.invalid" to R.string.validation_username_invalid,
        "validation.password.tooShort" to R.string.validation_password_tooShort,
        "validation.password.letterRequired" to R.string.validation_password_letterRequired,
        "validation.password.digitRequired" to R.string.validation_password_digitRequired,
        "validation.password.specialRequired" to R.string.validation_password_specialRequired,
        "validation.password.tooLong" to R.string.validation_password_tooLong,
        "validation.twoFactor.codeFormat" to R.string.validation_twoFactor_codeFormat,
        "validation.birthDate.implausible" to R.string.validation_birthDate_implausible,
        "validation.consent.guardianRequired" to R.string.validation_consent_guardianRequired,
        "validation.consent.required" to R.string.validation_consent_required,
        "validation.onboarding.stepNotSkippable" to R.string.validation_onboarding_stepNotSkippable,
        "validation.date.format" to R.string.validation_date_format,
        "validation.date.invalid" to R.string.validation_date_invalid,
        "validation.time.format" to R.string.validation_time_format,
        "validation.range.endAfterStart" to R.string.validation_range_endAfterStart,
        "validation.range.endNotBeforeStart" to R.string.validation_range_endNotBeforeStart,
        "validation.range.startBeforeEnd" to R.string.validation_range_startBeforeEnd,
        "validation.range.bothBounds" to R.string.validation_range_bothBounds,
        "validation.range.tooLong" to R.string.validation_range_tooLong,
        "validation.timeZone.unknown" to R.string.validation_timeZone_unknown,
        "validation.common.nothingToChange" to R.string.validation_common_nothingToChange,
        "validation.common.duplicateIds" to R.string.validation_common_duplicateIds,
        "validation.common.reasonRequired" to R.string.validation_common_reasonRequired,
        "validation.common.rejectionReasonRequired" to R.string.validation_common_rejectionReasonRequired,
        "validation.common.textOrAttachment" to R.string.validation_common_textOrAttachment,
        "validation.common.pageLimit" to R.string.validation_common_pageLimit,
        "validation.url.httpOnly" to R.string.validation_url_httpOnly,
        "validation.url.website" to R.string.validation_url_website,
        "validation.phone.format" to R.string.validation_phone_format,
        "validation.version.format" to R.string.validation_version_format,
        "validation.upload.partRangeReversed" to R.string.validation_upload_partRangeReversed,
        "validation.security.documentLast4" to R.string.validation_security_documentLast4,
        "validation.security.documentTypeRequired" to R.string.validation_security_documentTypeRequired,
        "validation.kato.code" to R.string.validation_kato_code,
        "validation.mini.linkCodeLength" to R.string.validation_mini_linkCodeLength,
        "validation.support.textTooShort" to R.string.validation_support_textTooShort,
        "validation.stories.duplicateRecipients" to R.string.validation_stories_duplicateRecipients,
        "validation.stories.recipientsOnlyForSelected" to R.string.validation_stories_recipientsOnlyForSelected,
        "validation.stories.duplicatePollOptions" to R.string.validation_stories_duplicatePollOptions,
        "validation.stories.tooManyMentions" to R.string.validation_stories_tooManyMentions,
        "validation.stories.tooManyCards" to R.string.validation_stories_tooManyCards,
        "validation.stories.empty" to R.string.validation_stories_empty,
        "validation.stories.backgroundTextOnly" to R.string.validation_stories_backgroundTextOnly,
        "validation.stories.linkLabelWithoutUrl" to R.string.validation_stories_linkLabelWithoutUrl,
        "validation.chats.nothingToChange" to R.string.validation_chats_nothingToChange,
        "validation.chats.emptyMessage" to R.string.validation_chats_emptyMessage,
        "validation.chats.privateOneMember" to R.string.validation_chats_privateOneMember,
        "validation.chats.spoilerIndexes" to R.string.validation_chats_spoilerIndexes,
        "validation.chats.quoteWithoutReply" to R.string.validation_chats_quoteWithoutReply,
        "validation.chats.scheduleInPast" to R.string.validation_chats_scheduleInPast,
        "validation.chats.scheduleTooFar" to R.string.validation_chats_scheduleTooFar,
        "validation.chats.reactionEmoji" to R.string.validation_chats_reactionEmoji,
        "validation.chats.contactEmpty" to R.string.validation_chats_contactEmpty,
        "validation.chats.stickerSlug" to R.string.validation_chats_stickerSlug,
        "validation.chats.livePeriod" to R.string.validation_chats_livePeriod,
        "validation.documents.typeCode" to R.string.validation_documents_typeCode,
        "validation.library.isbn" to R.string.validation_library_isbn,
        "validation.library.copiesOrCount" to R.string.validation_library_copiesOrCount,
        "validation.library.copyRefRequired" to R.string.validation_library_copyRefRequired,
        "validation.library.popularPeriod" to R.string.validation_library_popularPeriod,
        "validation.applications.tooManyFields" to R.string.validation_applications_tooManyFields,
        "validation.applications.fileOrDocument" to R.string.validation_applications_fileOrDocument,
        "validation.applications.documentTypeRequired" to R.string.validation_applications_documentTypeRequired,
        "validation.applications.catalogCode" to R.string.validation_applications_catalogCode,
        "validation.applications.choiceOptionsRequired" to R.string.validation_applications_choiceOptionsRequired,
        "validation.applications.duplicateDeliveryMode" to R.string.validation_applications_duplicateDeliveryMode,
        "validation.applications.duplicateRequirementCodes" to R.string.validation_applications_duplicateRequirementCodes,
        "validation.applications.duplicateFieldCodes" to R.string.validation_applications_duplicateFieldCodes,
        "validation.org.foundedYearFuture" to R.string.validation_org_foundedYearFuture,
        "validation.org.telegram" to R.string.validation_org_telegram,
        "validation.org.instagram" to R.string.validation_org_instagram,
        "validation.org.linkedin" to R.string.validation_org_linkedin,
        "validation.cameras.rtspScheme" to R.string.validation_cameras_rtspScheme,
        "validation.cameras.credentialsInUrl" to R.string.validation_cameras_credentialsInUrl,
        "validation.cameras.hostMissing" to R.string.validation_cameras_hostMissing,
        "validation.career.slug" to R.string.validation_career_slug,
        "validation.schedule.newRoomRequired" to R.string.validation_schedule_newRoomRequired,
        "validation.schedule.substituteRequired" to R.string.validation_schedule_substituteRequired,
        "validation.schedule.newStartRequired" to R.string.validation_schedule_newStartRequired,
        "validation.schedule.newEndRequired" to R.string.validation_schedule_newEndRequired,
    )

    /** Все известные сборке ключи — для теста сверки с реестром. */
    val keys: Set<String> get() = byKey.keys

    @StringRes
    fun res(key: String): Int? = byKey[key]
}

/** Перевод ошибки поля, если сервер прислал ключ валидации; иначе `null`. */
val ApiErrorDetail.validationText: UiText?
    get() = ValidationMessages.res(message)?.let { UiText.Res(it) }
