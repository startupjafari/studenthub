package kz.studenthub.app.core.applications

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kz.studenthub.app.core.network.ApiClient
import kz.studenthub.app.core.network.Endpoint
import kz.studenthub.app.core.network.HttpMethod
import kz.studenthub.app.core.network.InstantSerializer
import java.time.Instant
import java.util.Locale

/*
 * Заявки и документы — по сервису (application-services, documents), сверено 15.10.2026.
 * Названия услуг и полей приходят на трёх языках, а подача требует способа получения и
 * документов по обязательным требованиям — без них сервер отвечает отказом.
 */

/** Текст на языке человека: казахский или английский, если он есть, иначе русский. */
fun localized(ru: String?, kk: String?, en: String?, locale: Locale = Locale.getDefault()): String =
    when (locale.language) {
        "kk" -> kk?.takeIf { it.isNotEmpty() }
        "en" -> en?.takeIf { it.isNotEmpty() }
        else -> null
    } ?: ru.orEmpty()

@Serializable
data class ServiceCategoryDto(
    val id: String,
    val code: String? = null,
    val nameRu: String,
    val nameKk: String? = null,
    val nameEn: String? = null,
    val services: List<ServiceDto> = emptyList(),
) {
    fun name(locale: Locale = Locale.getDefault()) = localized(nameRu, nameKk, nameEn, locale)
}

@Serializable
data class ServiceDto(
    val id: String,
    val code: String? = null,
    val nameRu: String,
    val nameKk: String? = null,
    val nameEn: String? = null,
    val descriptionRu: String? = null,
    val descriptionKk: String? = null,
    val descriptionEn: String? = null,
    val instructionsRu: String? = null,
    val instructionsKk: String? = null,
    val instructionsEn: String? = null,
    /** Срок по SLA в часах — так его и показывает веб. */
    val slaHours: Int? = null,
    /** `ELECTRONIC`, `PAPER` — что услуга умеет выдавать. */
    val deliveryModes: List<String> = emptyList(),
    val requirements: List<Requirement> = emptyList(),
    val formFields: List<FormField> = emptyList(),
) {
    fun name(locale: Locale = Locale.getDefault()) = localized(nameRu, nameKk, nameEn, locale)

    fun description(locale: Locale = Locale.getDefault()) = localized(descriptionRu, descriptionKk, descriptionEn, locale).ifEmpty { null }

    fun instructions(locale: Locale = Locale.getDefault()) = localized(instructionsRu, instructionsKk, instructionsEn, locale).ifEmpty { null }

    /**
     * Какие способы получения можно выбрать — то же правило, что на сервере
     * (`allowedDeliveryTypes`): оба способа дают ещё и «оба сразу».
     */
    val deliveryTypes: List<String>
        get() {
            val electronic = "ELECTRONIC" in deliveryModes
            val paper = "PAPER" in deliveryModes
            return buildList {
                if (electronic) add("ELECTRONIC")
                if (paper) add("PAPER")
                if (electronic && paper) add("BOTH")
            }
        }

    @Serializable
    data class Requirement(
        val id: String,
        val code: String? = null,
        val documentType: String? = null,
        val titleRu: String,
        val titleKk: String? = null,
        val titleEn: String? = null,
        val description: String? = null,
        val required: Boolean = false,
    ) {
        fun title(locale: Locale = Locale.getDefault()) = localized(titleRu, titleKk, titleEn, locale)
    }

    @Serializable
    data class FormField(
        val id: String,
        val code: String,
        /** TEXT, TEXTAREA, NUMBER, DATE, SELECT, RADIO, CHECKBOX, BOOLEAN. */
        val type: String,
        val labelRu: String,
        val labelKk: String? = null,
        val labelEn: String? = null,
        val placeholderRu: String? = null,
        val placeholderKk: String? = null,
        val placeholderEn: String? = null,
        val required: Boolean = false,
        val options: List<Option>? = null,
    ) {
        fun label(locale: Locale = Locale.getDefault()) = localized(labelRu, labelKk, labelEn, locale)

        fun placeholder(locale: Locale = Locale.getDefault()) = localized(placeholderRu, placeholderKk, placeholderEn, locale).ifEmpty { null }
    }

    @Serializable
    data class Option(val value: String, val labelRu: String, val labelKk: String? = null, val labelEn: String? = null) {
        fun label(locale: Locale = Locale.getDefault()) = localized(labelRu, labelKk, labelEn, locale)
    }
}

@Serializable
data class ApplicationDto(
    val id: String,
    val number: String? = null,
    val status: String,
    val deliveryType: String? = null,
    val formData: JsonObject? = null,
    @Serializable(InstantSerializer::class) val createdAt: Instant,
    @Serializable(InstantSerializer::class) val submittedAt: Instant? = null,
    @Serializable(InstantSerializer::class) val dueAt: Instant? = null,
    val rejectionReason: String? = null,
    val pickupLocation: String? = null,
    val pickupInstructions: String? = null,
    val service: ServiceRef? = null,
    val events: List<Event> = emptyList(),
    val results: List<Result> = emptyList(),
) {
    @Serializable
    data class ServiceRef(val id: String, val nameRu: String, val nameKk: String? = null, val nameEn: String? = null) {
        fun name(locale: Locale = Locale.getDefault()) = localized(nameRu, nameKk, nameEn, locale)
    }

    /** Шаг истории: смена статуса с комментарием сотрудника. */
    @Serializable
    data class Event(
        val id: String,
        val action: String? = null,
        val fromStatus: String? = null,
        val toStatus: String? = null,
        val comment: String? = null,
        @Serializable(InstantSerializer::class) val createdAt: Instant,
    )

    /** Выданный результат: документ, номер, примечание. */
    @Serializable
    data class Result(
        val id: String,
        val type: String? = null,
        val documentId: String? = null,
        val documentNumber: String? = null,
        val note: String? = null,
        @Serializable(InstantSerializer::class) val createdAt: Instant? = null,
    )
}

@Serializable
data class DocumentDto(
    val id: String,
    val category: String? = null,
    val type: String? = null,
    val title: String? = null,
    val numberMasked: String? = null,
    val issuedBy: String? = null,
    @Serializable(InstantSerializer::class) val issuedAt: Instant? = null,
    @Serializable(InstantSerializer::class) val expiresAt: Instant? = null,
    val status: String? = null,
    val files: List<File> = emptyList(),
) {
    @Serializable
    data class File(val id: String, val mime: String? = null, val size: Long? = null, val order: Int? = null)
}

interface ApplicationsFetching {
    suspend fun categories(): List<ServiceCategoryDto>

    suspend fun service(id: String): ServiceDto

    suspend fun applications(): List<ApplicationDto>

    suspend fun application(id: String): ApplicationDto

    suspend fun createDraft(serviceId: String): ApplicationDto

    suspend fun updateDraft(id: String, deliveryType: String?, formData: Map<String, JsonElement>)

    suspend fun attachDocument(id: String, requirementId: String, documentId: String)

    suspend fun submit(id: String)

    suspend fun cancel(id: String, reason: String?)

    suspend fun documents(): List<DocumentDto>

    suspend fun documentFileUrl(documentId: String, fileId: String): String

    suspend fun resultUrl(applicationId: String, resultId: String): String
}

class ApplicationsApi(private val client: ApiClient) : ApplicationsFetching {
    override suspend fun categories(): List<ServiceCategoryDto> =
        client.send(Endpoint.get("application-categories"), ListSerializer(ServiceCategoryDto.serializer()))

    override suspend fun service(id: String): ServiceDto = client.send(Endpoint.get("application-services/$id"), ServiceDto.serializer())

    /** Свои заявки. Схема запроса строгая: только известные параметры. */
    override suspend fun applications(): List<ApplicationDto> =
        client.page(Endpoint.get("applications", "limit" to "50"), ApplicationDto.serializer()).items

    override suspend fun application(id: String): ApplicationDto = client.send(Endpoint.get("applications/$id"), ApplicationDto.serializer())

    /** Заявка заводится черновиком, заполняется и только потом подаётся — человек может уйти и вернуться. */
    override suspend fun createDraft(serviceId: String): ApplicationDto =
        client.send(Endpoint.post("applications", CreateBody.serializer(), CreateBody(serviceId)), ApplicationDto.serializer())

    override suspend fun updateDraft(id: String, deliveryType: String?, formData: Map<String, JsonElement>) {
        client.send(Endpoint.json(HttpMethod.PATCH, "applications/$id", UpdateBody.serializer(), UpdateBody(deliveryType, JsonObject(formData))))
    }

    override suspend fun attachDocument(id: String, requirementId: String, documentId: String) {
        client.send(Endpoint.post("applications/$id/documents", AttachBody.serializer(), AttachBody(requirementId, documentId)))
    }

    override suspend fun submit(id: String) {
        client.send(Endpoint.post("applications/$id/submit"))
    }

    override suspend fun cancel(id: String, reason: String?) {
        client.send(Endpoint.post("applications/$id/cancel", CancelBody.serializer(), CancelBody(reason)))
    }

    /** Документы — простым массивом. Запрос строгий и без `limit`: лишний параметр — отказ. */
    override suspend fun documents(): List<DocumentDto> = client.send(Endpoint.get("documents"), ListSerializer(DocumentDto.serializer()))

    override suspend fun documentFileUrl(documentId: String, fileId: String): String =
        client.send(Endpoint.get("documents/$documentId/files/$fileId/url", "download" to "1"), Url.serializer()).url

    override suspend fun resultUrl(applicationId: String, resultId: String): String =
        client.send(Endpoint.get("applications/$applicationId/results/$resultId/url", "download" to "1"), Url.serializer()).url

    @Serializable
    private data class CreateBody(val serviceId: String)

    @Serializable
    private data class UpdateBody(val deliveryType: String?, val formData: JsonObject)

    @Serializable
    private data class AttachBody(val requirementId: String, val documentId: String)

    @Serializable
    private data class CancelBody(val reason: String?)

    @Serializable
    private data class Url(val url: String)
}
