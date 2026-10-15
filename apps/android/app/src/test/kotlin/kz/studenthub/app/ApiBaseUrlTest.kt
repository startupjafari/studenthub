package kz.studenthub.app

import org.junit.Assert.assertTrue
import org.junit.Test

class ApiBaseUrlTest {
    // Клиент склеивает пути вида "/auth/login" с базой. Без префикса версии или с
    // лишней косой чертой в конце все запросы уйдут мимо API.
    @Test
    fun baseUrlPointsToVersionedApiWithoutTrailingSlash() {
        val url = BuildConfig.API_BASE_URL
        assertTrue("ожидался префикс /api/v1: $url", url.endsWith("/api/v1"))
        assertTrue("ожидалась схема http(s): $url", url.startsWith("http://") || url.startsWith("https://"))
    }
}
