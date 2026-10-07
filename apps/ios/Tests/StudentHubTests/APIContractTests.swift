import XCTest

@testable import StudentHub

/// Конверт ответа — публичный контракт API (PROJECT.md §8.1). Эти тесты держат
/// клиент на нём: расхождение здесь выглядит на экране как пустой список без ошибки.
final class APIContractTests: XCTestCase {
    func testSuccessEnvelopeUnwrapsDataAndMeta() throws {
        let json = Data(
            """
            {"success":true,"data":[{"id":"a"},{"id":"b"}],"meta":{"cursor":"c-2","hasNext":true}}
            """.utf8
        )

        let envelope = try JSONCoding.decoder.decode(APISuccessEnvelope<[Item]>.self, from: json)

        XCTAssertEqual(envelope.data.map(\.id), ["a", "b"])
        XCTAssertEqual(envelope.meta?.cursor, "c-2")
        XCTAssertEqual(envelope.meta?.hasNext, true)
        XCTAssertNil(envelope.meta?.total)
    }

    func testErrorEnvelopeCarriesCodeAndDetails() throws {
        let json = Data(
            """
            {"success":false,"error":{"code":"VALIDATION_ERROR","message":"Ошибка валидации",
            "details":[{"field":"email","message":"Неверный адрес"}]},
            "statusCode":422,"timestamp":"2026-10-06T10:00:00.000Z","path":"/api/v1/auth/login"}
            """.utf8
        )

        let envelope = try JSONCoding.decoder.decode(APIErrorEnvelope.self, from: json)

        XCTAssertEqual(APIErrorCode(rawValue: envelope.error.code), .validationError)
        XCTAssertEqual(envelope.statusCode, 422)
        XCTAssertEqual(envelope.error.details?.first?.field, "email")
    }

    /// Новый код появится на сервере раньше, чем все обновят приложение. Старая
    /// сборка обязана показать сообщение, а не упасть на разборе.
    func testUnknownCodeFallsBackInsteadOfFailing() {
        XCTAssertEqual(APIErrorCode(rawValue: "SOMETHING_NEW"), .unknown("SOMETHING_NEW"))
    }

    func testOnlyAuthFailuresTriggerRefresh() {
        XCTAssertTrue(APIErrorCode.unauthorized.meansSessionExpired)
        XCTAssertTrue(APIErrorCode.tokenExpired.meansSessionExpired)
        // Прав нет — повтор с новым токеном ничего не изменит.
        XCTAssertFalse(APIErrorCode.forbidden.meansSessionExpired)
        XCTAssertFalse(APIErrorCode.wrongScope.meansSessionExpired)
    }

    private struct Item: Decodable {
        let id: String
    }
}

/// Сервер отдаёт `new Date().toISOString()` — с долями секунды. Встроенная
/// стратегия `.iso8601` на них падает, и это роняло бы любой экран с датами.
final class DateDecodingTests: XCTestCase {
    func testFractionalSeconds() throws {
        let date = try decode("2026-10-06T12:34:56.789Z")
        XCTAssertEqual(date.timeIntervalSince1970, 1791290096.789, accuracy: 0.002)
    }

    func testWithoutFractionalSeconds() throws {
        let date = try decode("2026-10-06T12:34:56Z")
        XCTAssertEqual(date.timeIntervalSince1970, 1791290096, accuracy: 0.002)
    }

    func testGarbageThrows() {
        XCTAssertThrowsError(try decode("вчера"))
    }

    private func decode(_ iso: String) throws -> Date {
        let json = Data(#"{"at":"\#(iso)"}"#.utf8)
        return try JSONCoding.decoder.decode(Moment.self, from: json).at
    }

    private struct Moment: Decodable {
        let at: Date
    }
}
