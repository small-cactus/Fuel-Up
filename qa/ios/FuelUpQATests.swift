import XCTest

final class FuelUpQATests: XCTestCase {
    let app = XCUIApplication(bundleIdentifier: "com.anthonyh.fuelup")

    func record(_ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
        print("QA_TREE_\(name)\n\(app.debugDescription)")
    }

    func testCleanOnboardingAndSettings() throws {
        continueAfterFailure = false
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        let next = app.buttons["onboarding-continue"]
        XCTAssertTrue(next.waitForExistence(timeout: 30))
        record("welcome")
        next.tap()
        record("predictive")
        next.tap()
        record("location")
        // Permission services are preconfigured on this isolated simulator;
        // denied and interrupted requests are covered by interaction tests.
        app.descendants(matching: .any)["onboarding-pages"].firstMatch.swipeLeft()
        record("notifications")
        app.descendants(matching: .any)["onboarding-pages"].firstMatch.swipeLeft()
        let radius = app.descendants(matching: .any)["onboarding-radius"].firstMatch
        XCTAssertTrue(radius.waitForExistence(timeout: 5))
        radius.coordinate(withNormalizedOffset: CGVector(dx: 0.62, dy: 0.5)).press(forDuration: 0.1, thenDragTo: radius.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 0.5)))
        record("radius-15")
        next.tap()
        let diesel = app.descendants(matching: .any)["onboarding-grade-diesel"].firstMatch
        XCTAssertTrue(diesel.waitForExistence(timeout: 5))
        diesel.tap()
        record("diesel")
        next.tap()
        XCTAssertTrue(app.tabBars.buttons["Settings"].waitForExistence(timeout: 30))
        record("home-first-launch")
        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["15 mi"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Diesel"].exists)
        record("settings-diesel-15")
        app.terminate()
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Settings"].waitForExistence(timeout: 30))
        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["15 mi"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Diesel"].exists)
        record("settings-after-relaunch")
        app.tabBars.buttons["Trends"].tap()
        record("trends")
        app.tabBars.buttons["Dev"].tap()
        record("dev")
    }
}
