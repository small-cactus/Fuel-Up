import SwiftUI

// Decorative prices have no connection to live station observations. Each
// capsule grows, holds, and disappears before its slot moves to a free area.
@available(iOS 16.0, *)
struct OnboardingPricePills: View {
  let isActive: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  // This is embedded in a UIKit pager, not a SwiftUI Scene. Use the owning
  // application's lifecycle rather than an unprovided scenePhase environment.
  @State private var appActive = UIApplication.shared.applicationState == .active
  @State private var samples = [Sample(id: 0, cell: 0), Sample(id: 1, cell: 3), Sample(id: 2, cell: 4)]
  @State private var scales: [CGFloat] = [0, 0, 0]

  private var animates: Bool { isActive && !reduceMotion && appActive }

  var body: some View {
    GeometryReader { geometry in
      ZStack {
        ForEach(samples) { sample in
          SamplePricePill(price: sample.price)
            .scaleEffect(scales[sample.id])
            .position(x: geometry.size.width * sample.x,
                      y: 90 + max(0, geometry.size.height - 125) * sample.y)
        }
        Text("Sample prices")
          .font(.caption2).foregroundStyle(.secondary)
          .position(x: geometry.size.width * 0.74, y: geometry.size.height - 8)
      }
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
    .onAppear { appActive = UIApplication.shared.applicationState == .active }
    .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
      appActive = true
    }
    .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in
      appActive = false
    }
    .task(id: animates) {
      withTransaction(Transaction(animation: nil)) {
        scales = reduceMotion ? [1, 1, 1] : [0, 0, 0]
      }
      guard animates else { return }
      var index = 0
      do {
        while !Task.isCancelled {
          if scales[index] > 0 {
            withAnimation(.easeIn(duration: 0.32)) { scales[index] = 0 }
            try await Task.sleep(nanoseconds: 380_000_000)
          }
          // Reserve the other capsules' cells and avoid the previous location.
          let occupied = Set(samples.map(\.cell))
          let nextCell = (0..<6).filter { !occupied.contains($0) }.randomElement()!
          samples[index] = Sample(id: index, cell: nextCell)
          try await Task.sleep(nanoseconds: 50_000_000)
          withAnimation(.easeOut(duration: 0.45)) { scales[index] = 1 }
          // Stagger three lifetimes: each holds still for several seconds
          // while the others appear, before shrinking and moving elsewhere.
          try await Task.sleep(nanoseconds: 1_600_000_000)
          index = (index + 1) % samples.count
        }
      } catch { /* Leaving the page or backgrounding cancels the sequence. */ }
    }
  }

  private struct Sample: Identifiable {
    let id: Int
    let cell: Int
    let price: String
    let x: CGFloat
    let y: CGFloat

    init(id: Int, cell: Int) {
      self.id = id
      self.cell = cell
      price = ["$3.89", "$4.49", "$4.59", "$4.65", "$4.72"].randomElement()!
      x = (cell.isMultiple(of: 2) ? 0.27 : 0.73) + CGFloat.random(in: -0.025...0.025)
      y = CGFloat(cell / 2) * 0.45 + CGFloat.random(in: -0.025...0.025)
    }
  }
}

private struct SamplePricePill: View {
  let price: String

  @ViewBuilder var body: some View {
    if #available(iOS 26.0, *) {
      label.glassEffect(.regular.tint(price == "$3.89" ? .green.opacity(0.3) : .clear), in: .capsule)
    } else {
      label.background(Color(uiColor: .secondarySystemGroupedBackground), in: Capsule())
    }
  }

  private var label: some View {
    HStack(spacing: 6) {
      Image(systemName: "fuelpump.fill").font(.system(size: 13, weight: .semibold))
      Text(price).font(.system(size: 16, weight: .bold, design: .rounded)).monospacedDigit()
    }
    .foregroundStyle(.primary)
    .padding(.horizontal, 12).frame(height: 34)
  }
}
