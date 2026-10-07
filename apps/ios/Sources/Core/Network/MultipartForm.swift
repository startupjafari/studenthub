import Foundation

/// Сборка `multipart/form-data`.
///
/// Нужна потому, что отправка сообщения на сервере — multipart-маршрут: в одном
/// запросе и текст, и вложения. Своя сборка вместо зависимости: тело здесь — три
/// строки заголовков вокруг данных, и библиотека ради этого не нужна.
struct MultipartForm {
    let boundary: String
    private var body = Data()

    init(boundary: String = "studenthub.\(UUID().uuidString)") {
        self.boundary = boundary
    }

    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    mutating func append(_ value: String, name: String) {
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
        body.append(value)
        body.append("\r\n")
    }

    mutating func append(_ data: Data, name: String, filename: String, mime: String) {
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n")
        body.append("Content-Type: \(mime)\r\n\r\n")
        body.append(data)
        body.append("\r\n")
    }

    /// Закрывающая граница обязательна: без неё сервер ждёт продолжения тела.
    func encoded() -> Data {
        var data = body
        data.append("--\(boundary)--\r\n")
        return data
    }
}

extension Data {
    fileprivate mutating func append(_ string: String) {
        append(Data(string.utf8))
    }
}

extension Endpoint {
    /// Запрос с multipart-телом.
    static func multipart(_ path: String, form: MultipartForm) -> Endpoint {
        var endpoint = Endpoint(method: .post, path: path, body: form.encoded())
        endpoint.contentType = form.contentType
        return endpoint
    }
}
