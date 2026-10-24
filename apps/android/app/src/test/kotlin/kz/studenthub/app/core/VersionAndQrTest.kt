package kz.studenthub.app.core

import kotlinx.coroutines.test.runTest
import kz.studenthub.app.core.network.ApiError
import kz.studenthub.app.core.network.ApiErrorCode
import kz.studenthub.app.core.session.QrLoginApproving
import kz.studenthub.app.core.session.QrLoginTicket
import kz.studenthub.app.core.session.QrRequester
import kz.studenthub.app.core.ui.UiText
import kz.studenthub.app.core.version.AppVersion
import kz.studenthub.app.core.version.ClientVersionCache
import kz.studenthub.app.core.version.ClientVersionChecking
import kz.studenthub.app.core.version.ClientVersionInfo
import kz.studenthub.app.features.auth.QrApproveModel
import kz.studenthub.app.features.update.UpdateGateModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class AppVersionTest {
    /** Строкой «1.10.0» меньше «1.9.0» — блокировка сработала бы наоборот на десятом релизе. */
    @Test
    fun orderIsNumericNotAlphabetical() = assertTrue(AppVersion.parse("1.9.0")!! < AppVersion.parse("1.10.0")!!)

    @Test
    fun equalVersionsAreEqual() = assertEquals(AppVersion.parse("2.0.1"), AppVersion.parse("2.0.1"))

    @Test
    fun garbageIsRejected() {
        listOf("1.2", "latest", "1.2.0-beta", "", "x.y.z", "1.2.3.4").forEach {
            assertNull("разобралось то, что версией не является: $it", AppVersion.parse(it))
        }
    }
}

class UpdateGateTest {
    private val store = "https://play.google.com/store/apps/details?id=kz.studenthub.app"

    @Test
    fun olderBuildIsBlocked() = runTest {
        val gate = gate("1.0.0", info("1.2.0"))
        gate.check()
        assertEquals(UpdateGateModel.State.Blocked(store), gate.state)
    }

    @Test
    fun currentBuildPasses() = runTest {
        val gate = gate("1.2.0", info("1.2.0"))
        gate.check()
        assertEquals(UpdateGateModel.State.Allowed, gate.state)
    }

    /** Авария на бэкенде не запирает приложение всем сразу. */
    @Test
    fun serverFailureLocksNobody() = runTest {
        val gate = UpdateGateModel(StubVersion(failure = offline()), MemoryCache(), "1.0.0")
        gate.check()
        assertEquals(UpdateGateModel.State.Allowed, gate.state)
    }

    /** Запуск без сети не отменяет принятое решение — иначе выключенный Wi-Fi обходит блокировку. */
    @Test
    fun rememberedAnswerSurvivesOfflineLaunch() = runTest {
        val gate = UpdateGateModel(StubVersion(failure = offline()), MemoryCache(info("1.2.0")), "1.0.0")
        gate.check()
        assertEquals(UpdateGateModel.State.Blocked(store), gate.state)
    }

    @Test
    fun freshAnswerIsRemembered() = runTest {
        val cache = MemoryCache()
        UpdateGateModel(StubVersion(info("1.2.0")), cache, "1.0.0").check()
        assertEquals("1.2.0", cache.load()?.minimumVersion)
    }

    /** Опечатка в переменной окружения не должна ломать приложение у всех. */
    @Test
    fun unparsableServerVersionDoesNotBlock() = runTest {
        val gate = gate("1.0.0", info("последняя"))
        gate.check()
        assertEquals(UpdateGateModel.State.Allowed, gate.state)
    }

    @Test
    fun blockWithoutStoreLink() = runTest {
        val gate = gate("1.0.0", ClientVersionInfo("android", "2.0.0", null))
        gate.check()
        assertEquals(UpdateGateModel.State.Blocked(null), gate.state)
    }

    private fun offline() = ApiError.Transport(IOException("offline"))

    private fun info(minimum: String) = ClientVersionInfo("android", minimum, store)

    private fun gate(current: String, answer: ClientVersionInfo) = UpdateGateModel(StubVersion(answer), MemoryCache(), current)

    private class StubVersion(private val answer: ClientVersionInfo? = null, private val failure: Exception? = null) :
        ClientVersionChecking {
        override suspend fun supportedVersion(): ClientVersionInfo = failure?.let { throw it } ?: answer!!
    }

    private class MemoryCache(private var stored: ClientVersionInfo? = null) : ClientVersionCache {
        override fun load() = stored

        override fun save(info: ClientVersionInfo) {
            stored = info
        }
    }
}

class QrLoginTest {
    private val token = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90"

    @Test
    fun ticketIsReadFromWebLink() = assertEquals(token, QrLoginTicket.parse("https://studenthub.kz/qr?t=$token")?.approveToken)

    @Test
    fun whitespaceAroundLinkIsTolerated() = assertNotNull(QrLoginTicket.parse(" https://studenthub.kz/qr?t=$token\n"))

    /** Главная проверка разбора: подтверждать вход, глядя на чужой код, нельзя. */
    @Test
    fun foreignCodesAreRejected() {
        listOf(
            "https://studenthub.kz/attendance/scan?t=$token",
            "https://studenthub.kz/qr",
            "https://studenthub.kz/qr?t=not-a-uuid",
            "WIFI:S:StudentHub;T:WPA;P:secret;;",
            "просто текст",
        ).forEach { assertNull("принят чужой код: $it", QrLoginTicket.parse(it)) }
    }

    /**
     * Между сканированием и запросом стоит подтверждение с устройством, которое просит
     * вход: молча или вслепую подтверждать вход нельзя.
     */
    @Test
    fun scanShowsRequesterBeforeConfirmation() = runTest {
        val api = StubApprover()
        val model = QrApproveModel(api)
        model.scanned("https://studenthub.kz/qr?t=$token")
        assertEquals(QrApproveModel.State.Checking(QrLoginTicket(token)), model.state)
        model.approve()
        assertEquals(0, api.calls)
        model.inspect()
        assertEquals(QrApproveModel.State.Confirming(QrLoginTicket(token), requester), model.state)
        assertEquals(0, api.calls)
    }

    /** Истёкший или уже подтверждённый код — до кнопки «Подтвердить» дело не доходит. */
    @Test
    fun expiredCodeFailsAtPreview() = runTest {
        val api = StubApprover(previewFailure = ApiError.Server(ApiErrorCode.NOT_FOUND, "x", emptyList(), 404))
        val model = QrApproveModel(api)
        model.scanned("https://studenthub.kz/qr?t=$token")
        model.inspect()
        assertEquals(QrApproveModel.State.Failed(UiText.Res(kz.studenthub.app.R.string.auth_qrApproveInvalid)), model.state)
    }

    @Test
    fun confirmedTicketIsSentToServer() = runTest {
        val api = StubApprover()
        val model = QrApproveModel(api)
        model.scanned("https://studenthub.kz/qr?t=$token")
        model.inspect()
        model.approve()
        assertEquals(1, api.calls)
        assertEquals(QrApproveModel.State.Approved, model.state)
    }

    /** Истёкший код — самый частый отказ: человек видит точные слова на своём языке, а не общую фразу. */
    @Test
    fun expiredSessionShowsInvalidCodeMessage() = runTest {
        val api = StubApprover(ApiError.Server(ApiErrorCode.NOT_FOUND, "QR-сессия не найдена или истекла", emptyList(), 404))
        val model = QrApproveModel(api)
        model.scanned("https://studenthub.kz/qr?t=$token")
        model.inspect()
        model.approve()
        assertEquals(QrApproveModel.State.Failed(UiText.Res(kz.studenthub.app.R.string.auth_qrApproveInvalid)), model.state)
    }

    @Test
    fun foreignCodeNeverReachesServer() = runTest {
        val api = StubApprover()
        val model = QrApproveModel(api)
        model.scanned("https://studenthub.kz/attendance/scan?t=$token")
        model.approve()
        assertEquals(0, api.calls)
        assertTrue(model.state is QrApproveModel.State.Failed)
    }

    private val requester = QrRequester(browser = "Chrome", os = "Windows", ip = "1.2.3.x")

    private inner class StubApprover(private val failure: ApiError? = null, private val previewFailure: ApiError? = null) : QrLoginApproving {
        var calls = 0

        override suspend fun preview(ticket: QrLoginTicket): QrRequester {
            previewFailure?.let { throw it }
            return requester
        }

        override suspend fun approve(ticket: QrLoginTicket) {
            calls++
            failure?.let { throw it }
        }
    }
}
