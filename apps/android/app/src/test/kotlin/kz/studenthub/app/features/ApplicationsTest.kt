package kz.studenthub.app.features

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kz.studenthub.app.core.applications.ApplicationDto
import kz.studenthub.app.core.applications.ApplicationsApi
import kz.studenthub.app.core.applications.ApplicationsFetching
import kz.studenthub.app.core.applications.DocumentDto
import kz.studenthub.app.core.applications.ServiceCategoryDto
import kz.studenthub.app.core.applications.ServiceDto
import kz.studenthub.app.core.applications.localized
import kz.studenthub.app.core.network.ApiClient
import kz.studenthub.app.features.applications.ApplicationFormModel
import kz.studenthub.app.features.applications.ApplicationStatus
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.util.Locale

class ApplicationsTest {
    private val service = ServiceDto(
        id = "s1",
        nameRu = "Справка с места учёбы",
        nameKk = "Оқу орнынан анықтама",
        deliveryModes = listOf("ELECTRONIC", "PAPER"),
        requirements = listOf(
            ServiceDto.Requirement("r1", documentType = "ID_CARD", titleRu = "Удостоверение", required = true),
            ServiceDto.Requirement("r2", titleRu = "Фото", required = false),
        ),
        formFields = listOf(
            ServiceDto.FormField("f1", "copies", "NUMBER", "Сколько экземпляров", required = true),
            ServiceDto.FormField("f2", "urgent", "CHECKBOX", "Срочно"),
            ServiceDto.FormField(
                "f3", "lang", "SELECT", "Язык", required = true,
                options = listOf(ServiceDto.Option("ru", "Русский"), ServiceDto.Option("kk", "Казахский")),
            ),
        ),
    )

    /** Способ получения — по тому же правилу, что на сервере: два способа дают и «оба». */
    @Test
    fun deliveryTypesFollowServerRule() {
        assertEquals(listOf("ELECTRONIC", "PAPER", "BOTH"), service.deliveryTypes)
        assertEquals(listOf("PAPER"), service.copy(deliveryModes = listOf("PAPER")).deliveryTypes)
    }

    @Test
    fun namesFollowLanguage() {
        assertEquals("Оқу орнынан анықтама", service.name(Locale.forLanguageTag("kk")))
        assertEquals("Справка с места учёбы", service.name(Locale.forLanguageTag("en")))
        assertEquals("ru", localized("ru", "", null, Locale.forLanguageTag("kk")))
    }

    /** Отозвать можно, пока заявку не взяли в работу — граф переходов сервера. */
    @Test
    fun cancellationFollowsTransitions() {
        assertTrue(ApplicationStatus.canCancel("SUBMITTED"))
        assertTrue(ApplicationStatus.canCancel("NEEDS_CORRECTION"))
        assertFalse(ApplicationStatus.canCancel("IN_REVIEW"))
        assertFalse(ApplicationStatus.isOpen("DELIVERED"))
    }

    /**
     * Без способа получения и обязательного документа сервер подачу отклонит — кнопка
     * не активна, пока они не выбраны.
     */
    @Test
    fun submissionNeedsDeliveryAndRequiredDocuments() = runTest {
        val model = ApplicationFormModel("s1", StubApplications(service))
        model.load()
        model.answers["copies"] = "2"
        model.answers["lang"] = "kk"
        assertFalse(model.isComplete)
        model.deliveryType = "ELECTRONIC"
        assertFalse(model.isComplete)
        model.attachments["r1"] = "doc-id"
        assertTrue(model.isComplete)
    }

    /** Единственный способ получения выбирается сам: спрашивать не о чем. */
    @Test
    fun singleDeliveryTypeIsPreselected() = runTest {
        val model = ApplicationFormModel("s1", StubApplications(service.copy(deliveryModes = listOf("PAPER"))))
        model.load()
        assertEquals("PAPER", model.deliveryType)
    }

    /** Ответы — в типах сервера: число числом, флажок логическим; пустое не отправляется. */
    @Test
    fun formDataIsTyped() = runTest {
        val model = ApplicationFormModel("s1", StubApplications(service))
        model.answers["copies"] = "2"
        model.answers["urgent"] = "true"
        val data = model.formData(service)
        assertEquals(JsonPrimitive(2.toBigDecimal()), data["copies"])
        assertEquals(JsonPrimitive(true), data["urgent"])
        assertNull(data["lang"])
    }

    /** Подача — черновик с ответами, документы, затем сама подача: порядок сервера. */
    @Test
    fun submitRunsServerSteps() = runTest {
        val api = StubApplications(service)
        val model = ApplicationFormModel("s1", api)
        model.load()
        model.answers["copies"] = "1"
        model.answers["lang"] = "ru"
        model.deliveryType = "BOTH"
        model.attachments["r1"] = "doc-1"
        model.submit()
        assertEquals(listOf("update:BOTH", "attach:r1:doc-1", "submit"), api.calls)
        assertTrue(model.submitted)
    }

    /** Документы подбираются по типу требования. */
    @Test
    fun documentsAreFilteredByRequirementType() = runTest {
        val model = ApplicationFormModel("s1", StubApplications(service))
        model.load()
        assertEquals(listOf("doc-1"), model.documentsFor(service.requirements[0]).map { it.id })
        assertEquals(2, model.documentsFor(service.requirements[1]).size)
    }

    private class StubApplications(private val service: ServiceDto) : ApplicationsFetching {
        val calls = mutableListOf<String>()

        override suspend fun categories() = emptyList<ServiceCategoryDto>()
        override suspend fun service(id: String) = service
        override suspend fun applications() = emptyList<ApplicationDto>()
        override suspend fun application(id: String) = ApplicationDto(id, status = "DRAFT", createdAt = Instant.EPOCH)
        override suspend fun createDraft(serviceId: String) = ApplicationDto("a1", status = "DRAFT", createdAt = Instant.EPOCH)
        override suspend fun updateDraft(id: String, deliveryType: String?, formData: Map<String, JsonElement>) {
            calls += "update:$deliveryType"
        }
        override suspend fun attachDocument(id: String, requirementId: String, documentId: String) {
            calls += "attach:$requirementId:$documentId"
        }
        override suspend fun submit(id: String) {
            calls += "submit"
        }
        override suspend fun cancel(id: String, reason: String?) {}
        override suspend fun documents() = listOf(DocumentDto("doc-1", type = "ID_CARD"), DocumentDto("doc-2", type = "DIPLOMA"))
        override suspend fun documentFileUrl(documentId: String, fileId: String) = "https://x"
        override suspend fun resultUrl(applicationId: String, resultId: String) = "https://x"
    }
}

class ApplicationsRequestTest {
    private val server = MockWebServer().apply { start() }
    private val api = ApplicationsApi(ApiClient(server.url("/api/v1/").toString(), OkHttpClient(), "android/1.0.0+1"))

    @After
    fun stop() = server.close()

    /** Запрос документов строгий и без пагинации: `limit` сервер отверг бы. */
    @Test
    fun documentsAreRequestedWithoutLimit() = runTest {
        server.enqueue(MockResponse.Builder().code(200).body("""{"success":true,"data":[]}""").build())
        api.documents()
        assertEquals("/api/v1/documents", server.takeRequest().target)
    }

    /** Карточка услуги в настоящем виде — с полями на трёх языках. */
    @Test
    fun serviceCardIsDecoded() = runTest {
        server.enqueue(
            MockResponse.Builder().code(200).body(
                """{"success":true,"data":{"id":"s1","code":"STUDY_CERT","nameRu":"Справка","nameKk":"Анықтама","nameEn":"Certificate",
                "slaHours":24,"deliveryModes":["ELECTRONIC"],"requiresPickup":false,"processingMode":"MANUAL",
                "requirements":[{"id":"r1","code":"ID","documentType":"ID_CARD","titleRu":"Удостоверение","titleKk":"Куәлік","titleEn":"ID","required":true,"allowStorage":true,"allowUpload":true,"maxFiles":2}],
                "formFields":[{"id":"f1","code":"lang","type":"SELECT","labelRu":"Язык","labelKk":"Тіл","labelEn":"Language","required":true,
                "options":[{"value":"ru","labelRu":"Русский","labelKk":"Орыс","labelEn":"Russian"}],"validation":null}]}}""",
            ).build(),
        )
        val service = api.service("s1")
        assertEquals("STUDY_CERT", service.code)
        assertEquals("ru", service.formFields.single().options?.single()?.value)
        assertEquals(listOf("ELECTRONIC"), service.deliveryTypes)
    }
}
