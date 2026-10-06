import Foundation

/// Кто выдаёт токен запросу и что делать, когда сервер его не принял.
///
/// Протокол нужен, чтобы сетевой слой не знал про хранение сессии, а сессия — про
/// формирование запросов: иначе они ссылаются друг на друга, и ни один не
/// тестируется в одиночку.
protocol AuthorizationProvider: Sendable {
    /// Действующий токен или `nil`, если пользователь не вошёл.
    func accessToken() async -> String?
    /// Сервер ответил 401. Вернуть новый токен, если сессию удалось продлить.
    func refreshedAccessToken() async -> String?
}

/// Единственная дверь в API.
///
/// Сюда стянуты все решения, которые иначе расползаются по экранам: конверт ответа,
/// коды ошибок, заголовки, повторы и один-единственный повтор после обновления токена.
actor APIClient {
    private let baseURL: URL
    private let session: URLSession
    private let authorization: AuthorizationProvider?
    private let maxRetries: Int

    init(
        baseURL: URL = AppConfiguration.apiBaseURL,
        session: URLSession = .shared,
        authorization: AuthorizationProvider? = nil,
        maxRetries: Int = 2
    ) {
        self.baseURL = baseURL
        self.session = session
        self.authorization = authorization
        self.maxRetries = maxRetries
    }

    /// Запрос с телом ответа.
    func send<Response: Decodable>(_ endpoint: Endpoint, as type: Response.Type) async throws -> Response {
        let data = try await perform(endpoint)
        do {
            return try JSONCoding.decoder.decode(APISuccessEnvelope<Response>.self, from: data).data
        } catch {
            throw APIError.decoding(underlying: error, statusCode: 200)
        }
    }

    /// Запрос со страницей списка: данные и курсоры приходят рядом, в одном конверте.
    func page<Item: Decodable>(_ endpoint: Endpoint, of type: Item.Type) async throws -> Page<Item> {
        let data = try await perform(endpoint)
        do {
            let envelope = try JSONCoding.decoder.decode(APISuccessEnvelope<[Item]>.self, from: data)
            return Page(items: envelope.data, meta: envelope.meta)
        } catch {
            throw APIError.decoding(underlying: error, statusCode: 200)
        }
    }

    /// Запрос без тела ответа (204 и операции, у которых ответ не нужен).
    func send(_ endpoint: Endpoint) async throws {
        _ = try await perform(endpoint)
    }

    // MARK: - Внутреннее

    private func perform(_ endpoint: Endpoint) async throws -> Data {
        let token = endpoint.requiresAuthorization ? await authorization?.accessToken() : nil

        do {
            return try await attempt(endpoint, token: token)
        } catch let error as APIError {
            // Ровно одна попытка продлить сессию. Второй 401 после свежего токена
            // означает, что дело не в сроке жизни, и повторять бесполезно.
            guard
                endpoint.requiresAuthorization,
                let code = error.code, code.meansSessionExpired,
                let refreshed = await authorization?.refreshedAccessToken()
            else { throw error }
            return try await attempt(endpoint, token: refreshed)
        }
    }

    private func attempt(_ endpoint: Endpoint, token: String?) async throws -> Data {
        var lastTransportError: URLError?

        for retry in 0...maxRetries {
            if retry > 0 {
                // Выдержка с ростом: 0.5 с, затем 1 с. Без неё повтор приходит в тот
                // же обрыв связи, только быстрее.
                try? await Task.sleep(for: .milliseconds(500 * (1 << (retry - 1))))
            }

            do {
                let (data, response) = try await session.data(for: request(for: endpoint, token: token))
                guard let http = response as? HTTPURLResponse else {
                    throw APIError.malformedResponse(statusCode: 0)
                }

                if (200..<300).contains(http.statusCode) { return data }

                let failure = serverError(from: data, statusCode: http.statusCode)
                // 5xx и 429 — состояние сервера, а не запроса: их имеет смысл
                // повторить, если запрос идемпотентный.
                let worthRetrying = http.statusCode >= 500 || http.statusCode == 429
                if worthRetrying, endpoint.isIdempotent, retry < maxRetries { continue }
                throw failure
            } catch let urlError as URLError {
                guard endpoint.isIdempotent, retry < maxRetries else {
                    throw APIError.transport(urlError)
                }
                lastTransportError = urlError
            }
        }

        throw APIError.transport(lastTransportError ?? URLError(.unknown))
    }

    private func request(for endpoint: Endpoint, token: String?) throws -> URLRequest {
        guard let url = endpoint.url(relativeTo: baseURL) else {
            throw APIError.malformedResponse(statusCode: 0)
        }

        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method.rawValue
        request.httpBody = endpoint.body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        // По нему сервер отличает сборки в логах и решает, не пора ли просить
        // человека обновиться (Задача Б3).
        request.setValue(AppConfiguration.clientVersion, forHTTPHeaderField: "X-Client-Version")
        if endpoint.body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    /// Разбор тела ошибки. Если сервер ответил не по контракту (упал прокси, отдал
    /// HTML), код выводим из статуса — экран всё равно должен что-то показать.
    private func serverError(from data: Data, statusCode: Int) -> APIError {
        guard let envelope = try? JSONCoding.decoder.decode(APIErrorEnvelope.self, from: data) else {
            return .malformedResponse(statusCode: statusCode)
        }
        return .server(
            code: APIErrorCode(rawValue: envelope.error.code),
            message: envelope.error.message,
            details: envelope.error.details ?? [],
            statusCode: statusCode
        )
    }
}
