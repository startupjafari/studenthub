import AVFoundation
import XCTest

@testable import StudentHub

/// Какой сбой ролика повторять, а какой окончателен (IOS_RULES 9.6.13).
final class VideoRecoveryTests: XCTestCase {
    func testNetworkDropIsRetried() {
        let error = NSError(domain: NSURLErrorDomain, code: NSURLErrorNetworkConnectionLost)
        XCTAssertEqual(VideoRecovery.classify(error, httpStatus: nil), .network)
        XCTAssertEqual(VideoRecovery.classify(nil, httpStatus: 503), .network)
    }

    func testExpiredTokenAsksForFreshLink() {
        XCTAssertEqual(VideoRecovery.classify(nil, httpStatus: 403), .expiredLink)
        XCTAssertEqual(VideoRecovery.classify(nil, httpStatus: 401), .expiredLink)
        // У HLS код HTTP приходит вложенной ошибкой CoreMedia.
        let underlying = NSError(domain: "CoreMediaErrorDomain", code: -12660)
        let error = NSError(
            domain: AVFoundationErrorDomain,
            code: AVError.Code.unknown.rawValue,
            userInfo: [NSUnderlyingErrorKey: underlying]
        )
        XCTAssertEqual(VideoRecovery.classify(error, httpStatus: nil), .expiredLink)
    }

    func testBrokenContentIsFinal() {
        XCTAssertEqual(VideoRecovery.classify(nil, httpStatus: 404), .content)
        let error = NSError(domain: AVFoundationErrorDomain, code: AVError.Code.fileFormatNotRecognized.rawValue)
        XCTAssertEqual(VideoRecovery.classify(error, httpStatus: nil), .content)
        let playlist = NSError(domain: "CoreMediaErrorDomain", code: -12642)
        XCTAssertEqual(VideoRecovery.classify(playlist, httpStatus: nil), .content)
    }

    /// Паузы растут и не бесконечны: 1, 2, 4, 8, 16 с — потом ошибка остаётся на экране.
    func testRetryDelaysGrow() {
        let delays = VideoRecovery.delays
        XCTAssertEqual(delays.first, .seconds(1))
        XCTAssertEqual(delays, delays.sorted())
        XCTAssertLessThanOrEqual(delays.count, 6)
    }
}
