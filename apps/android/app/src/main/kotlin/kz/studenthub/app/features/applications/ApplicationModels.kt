package kz.studenthub.app.features.applications

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kz.studenthub.app.R
import kz.studenthub.app.core.applications.ApplicationsFetching
import kz.studenthub.app.core.applications.DocumentDto
import kz.studenthub.app.core.applications.ServiceDto
import kz.studenthub.app.core.network.displayMessage
import kz.studenthub.app.core.ui.UiText

/** Статусы заявки на языке человека — по серверному списку статусов, а не по догадке. */
object ApplicationStatus {
    fun title(status: String): Int? = when (status) {
        "DRAFT" -> R.string.applications_draft
        "SUBMITTED" -> R.string.applications_submitted
        "IN_REVIEW" -> R.string.applications_inReview
        "NEEDS_CORRECTION" -> R.string.applications_needsCorrection
        "RESUBMITTED" -> R.string.applications_resubmitted
        "IN_PREPARATION" -> R.string.applications_inPreparation
        "READY" -> R.string.applications_ready
        "READY_FOR_PICKUP" -> R.string.applications_readyForPickup
        "ISSUED" -> R.string.applications_issued
        "DELIVERED" -> R.string.applications_delivered
        "REJECTED" -> R.string.applications_rejected
        "CANCELLED" -> R.string.applications_cancelled
        else -> null
    }

    /** Заявка ещё в работе — это видно по цвету. */
    fun isOpen(status: String): Boolean = status !in setOf("ISSUED", "DELIVERED", "REJECTED", "CANCELLED")

    /** Отозвать можно, пока сотрудник не взял заявку в работу — тот же граф переходов, что на сервере. */
    fun canCancel(status: String): Boolean = status in setOf("DRAFT", "SUBMITTED", "NEEDS_CORRECTION")

    fun delivery(type: String): Int = when (type) {
        "PAPER" -> R.string.applications_deliveryPaper
        "BOTH" -> R.string.applications_deliveryBoth
        else -> R.string.applications_deliveryElectronic
    }
}

/**
 * Подача заявки. Форма строится по ответу сервера: состав полей задаёт вуз, и каждая
 * новая услуга иначе требовала бы релиза. Черновик заводится сразу: заполненное живёт
 * на сервере, а не пропадает вместе с экраном.
 *
 * Без способа получения и документов по обязательным требованиям сервер подачу
 * отклонит — поэтому оба шага здесь, а кнопка не нажимается, пока они не сделаны.
 */
class ApplicationFormModel(private val serviceId: String, private val api: ApplicationsFetching) : ViewModel() {
    var service by mutableStateOf<ServiceDto?>(null)
        private set
    var draftId by mutableStateOf<String?>(null)
        private set

    /** Ответы формы: значение — строкой, флажок — «true»/«false». */
    val answers = mutableStateMapOf<String, String>()
    var deliveryType by mutableStateOf<String?>(null)

    /** Требование → выбранный из хранилища документ. */
    val attachments = mutableStateMapOf<String, String>()
    var documents by mutableStateOf<List<DocumentDto>>(emptyList())
        private set

    var isSubmitting by mutableStateOf(false)
        private set
    var submitted by mutableStateOf(false)
        private set
    var failure by mutableStateOf<UiText?>(null)
        private set

    suspend fun load() {
        try {
            val loaded = api.service(serviceId)
            service = loaded
            // Единственный способ получения выбирается сам: спрашивать не о чем.
            if (deliveryType == null) deliveryType = loaded.deliveryTypes.singleOrNull()
            val draft = api.createDraft(serviceId)
            draftId = draft.id
            draft.formData?.forEach { (key, value) -> answers.putIfAbsent(key, value.asText()) }
            draft.deliveryType?.let { deliveryType = it }
            if (loaded.requirements.isNotEmpty()) documents = api.documents()
            failure = null
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            failure = error.displayMessage()
        }
    }

    /** Документы, подходящие под требование: по типу, если он задан. */
    fun documentsFor(requirement: ServiceDto.Requirement): List<DocumentDto> =
        documents.filter { requirement.documentType == null || it.type == requirement.documentType }

    val isComplete: Boolean
        get() {
            val loaded = service ?: return false
            val fieldsFilled = loaded.formFields.filter { it.required }.all { field ->
                val value = answers[field.code].orEmpty().trim()
                if (field.type == "CHECKBOX" || field.type == "BOOLEAN") value == "true" else value.isNotEmpty()
            }
            val documentsAttached = loaded.requirements.filter { it.required }.all { attachments[it.id] != null }
            return fieldsFilled && documentsAttached && deliveryType != null
        }

    fun submitNow() {
        viewModelScope.launch { submit() }
    }

    suspend fun submit() {
        val id = draftId ?: return
        val loaded = service ?: return
        if (isSubmitting || !isComplete) return
        isSubmitting = true
        try {
            api.updateDraft(id, deliveryType, formData(loaded))
            attachments.forEach { (requirement, document) -> api.attachDocument(id, requirement, document) }
            api.submit(id)
            submitted = true
            failure = null
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            failure = error.displayMessage()
        } finally {
            isSubmitting = false
        }
    }

    /**
     * Ответы — в типах, которые ждёт сервер: число числом, флажок логическим, выбор —
     * значением варианта. Пустые не отправляем: «пусто» и «нет ответа» сервер не различает.
     */
    fun formData(loaded: ServiceDto): Map<String, JsonElement> = buildMap {
        for (field in loaded.formFields) {
            val raw = answers[field.code]?.trim().orEmpty()
            val value: JsonElement = when (field.type) {
                "CHECKBOX", "BOOLEAN" -> JsonPrimitive(raw == "true")
                "NUMBER" -> raw.toBigDecimalOrNull()?.let(::JsonPrimitive) ?: continue
                else -> if (raw.isEmpty()) continue else JsonPrimitive(raw)
            }
            put(field.code, value)
        }
    }

    private fun JsonElement.asText(): String = (this as? JsonPrimitive)?.let { it.booleanOrNull?.toString() ?: it.contentOrNull }.orEmpty()
}
