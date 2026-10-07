import Foundation

/// Идёт ли прогон интерфейсных тестов.
///
/// Объявлено вне `#if DEBUG` намеренно: флаг читают и те места, что есть в релизной
/// сборке. В релизе аргумента не бывает, значит значение всегда ложно, а ветка с
/// подменой сети туда и не попадает — она под `#if DEBUG` ниже.
enum UITestMode {
    static let launchArgument = "-uiTestStub"
    static let isActive = ProcessInfo.processInfo.arguments.contains(launchArgument)
}

#if DEBUG
    /// Сеть для интерфейсных тестов: отвечает заготовками, наружу не выходит.
    ///
    /// Подменяется транспорт, а не сервисы. Приложение собирается ровно то же самое и
    /// проходит тот же путь — конверт ответа, разбор, экраны; отличается только то,
    /// откуда пришли байты. Мок на уровне сервисов проверял бы совсем другое
    /// приложение, а обход экранов ради этого и затевался.
    ///
    /// Неизвестный путь получает пустой успешный ответ, а не ошибку: цель обхода —
    /// пройти все экраны, а не доказать, что заготовки покрывают весь API. Экран со
    /// списком покажет пустое состояние, и это честная картинка.
    final class UITestStubProtocol: URLProtocol {
        /// Срок — 2100 год: тест не должен начать падать однажды утром.
        private static let accessToken = """
            eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1aS10ZXN0LXN0dWRlbnQiLCJyb2xlIjoiU1RVREVOVCIsInVuaXZlcnNpdHlJZCI6InUtMSIsImZhY3VsdHlJZCI6ImYtMSIsImdyb3VwSWQiOiJnLTEiLCJ0ZmEiOmZhbHNlLCJleHAiOjQxMDI0NDQ4MDB9.ui-test-signature-not-verified
            """

        override class func canInit(with request: URLRequest) -> Bool { true }

        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func stopLoading() {}

        override func startLoading() {
            guard let url = request.url else {
                client?.urlProtocol(self, didFailWithError: URLError(.badURL))
                return
            }

            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )
            guard let response else {
                client?.urlProtocol(self, didFailWithError: URLError(.cannotParseResponse))
                return
            }

            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(Self.body(forPath: url.path).utf8))
            client?.urlProtocolDidFinishLoading(self)
        }

        private static func body(forPath path: String) -> String {
            if path.hasSuffix("/auth/login") || path.hasSuffix("/auth/refresh") {
                return #"{"success":true,"data":{"accessToken":"\#(accessToken)"}}"#
            }
            if path.hasSuffix("/client-version") {
                // Заведомо старая минимальная версия: экран «обновитесь» не должен
                // закрыть собой весь обход.
                return #"{"success":true,"data":{"platform":"ios","minimumVersion":"0.0.1"}}"#
            }
            return #"{"success":true,"data":[]}"#
        }
    }
#endif
