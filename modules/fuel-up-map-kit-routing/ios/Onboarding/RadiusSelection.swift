import Foundation

// Shared by the gesture, slider, accessibility adjustment, and regression tests.
enum RadiusSelection {
  static let minimum = 2.0
  static let maximum = 15.0
  static let notches = Array(2...15)
  static func clamp(_ value: Double) -> Double { min(maximum, max(minimum, value.isFinite ? value : minimum)) }
  static func snap(_ value: Double) -> Double { clamp(value).rounded() }
  static func scaled(_ start: Double, by scale: Double) -> Double { clamp(start * scale) }
}
