import XCTest

final class FuelUpQATests: XCTestCase {
    let app = XCUIApplication(bundleIdentifier: "com.anthonyh.fuelup")

    func waitPage(_ page: Int) -> Bool {
        let value = NSPredicate(format: "value == %@", "\(page) of 7")
        return XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: value, object: app.buttons["onboarding-continue"])], timeout: 15) == .completed
    }

    // This unsigned simulator binary cannot read the Expo push Keychain. Dismiss
    // only that known development warning so it cannot intercept the tab bar.
    func dismissUnsignedSimulatorWarning() {
        let warning = app.descendants(matching: .any).matching(NSPredicate(format:
            "label BEGINSWITH %@", "!, [expo-notifications] Error reading persisted server registration info:")).firstMatch
        if warning.waitForExistence(timeout: 2) {
            warning.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        }
    }

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
        dismissUnsignedSimulatorWarning()
        record("welcome")
        next.tap()
        XCTAssertTrue(waitPage(2))
        record("predictive")
        next.tap()
        XCTAssertTrue(waitPage(3))
        record("location")
        // Permission services are preconfigured on this isolated simulator;
        // denied and interrupted requests are covered by interaction tests.
        next.tap()
        let notificationsPage = app.descendants(matching: .any)["onboarding-notifications"].firstMatch
        XCTAssertTrue(waitPage(4))
        notificationsPage.swipeUp()
        let lastBenefit = app.staticTexts["Alerts when you're about to get a bad deal at a gas station"].firstMatch
        XCTAssertTrue(lastBenefit.exists)
        XCTAssertLessThan(lastBenefit.frame.maxY, next.frame.minY)
        record("notifications")
        next.tap()
        let radius = app.descendants(matching: .any)["onboarding-radius"].firstMatch
        XCTAssertTrue(waitPage(5))
        radius.coordinate(withNormalizedOffset: CGVector(dx: 0.62, dy: 0.5)).press(forDuration: 0.1, thenDragTo: radius.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 0.5)))
        record("radius-15")
        next.tap()
        let e85 = app.buttons["E85"]
        XCTAssertTrue(waitPage(6))
        e85.tap()
        let requireE85 = app.descendants(matching: .any)["onboarding-requires-e85"].firstMatch
        if !requireE85.isHittable { app.swipeUp() }
        XCTAssertTrue(requireE85.waitForExistence(timeout: 5))
        requireE85.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertEqual(requireE85.value as? String, "1")
        record("e85")
        next.tap()
        XCTAssertTrue(waitPage(7))
        let brand = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "brand-preference-")).firstMatch
        XCTAssertTrue(brand.waitForExistence(timeout: 20))
        brand.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertEqual(brand.value as? String, "1")
        record("preferred-brands")
        next.tap()
        XCTAssertTrue(app.tabBars.buttons["Settings"].waitForExistence(timeout: 30))
        record("home-first-launch")
        dismissUnsignedSimulatorWarning()
        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["15 mi"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["E85"].exists)
        XCTAssertEqual(app.descendants(matching: .any)["settings-requires-e85"].firstMatch.value as? String, "1")
        XCTAssertTrue(app.staticTexts["1 selected"].exists)
        record("settings-e85-15")
        app.terminate()
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Settings"].waitForExistence(timeout: 30))
        dismissUnsignedSimulatorWarning()
        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["15 mi"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["E85"].exists)
        XCTAssertEqual(app.descendants(matching: .any)["settings-requires-e85"].firstMatch.value as? String, "1")
        XCTAssertTrue(app.staticTexts["1 selected"].exists)
        record("settings-after-relaunch")
        app.tabBars.buttons["Trends"].tap()
        record("trends")
        app.tabBars.buttons["Dev"].tap()
        record("dev")
    }
}
