import SwiftUI

// Decorative prices have no connection to live station observations. Each
// capsule grows, holds, and disappears before its slot moves to a free area.
// The best-price identity stays green through the same cycle as the other chips.
@available(iOS 16.0, *)
struct OnboardingPricePills: View {
  let isActive: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  // This is embedded in a UIKit pager, not a SwiftUI Scene. Use the owning
  // application's lifecycle rather than an unprovided scenePhase environment.
  @State private var appActive = UIApplication.shared.applicationState == .active
  @State private var samples = [
    Sample(id: 0, cell: 0, isBest: true),
    Sample(id: 1, cell: 3),
    Sample(id: 2, cell: 4)
  ]
  private let bestID = 0
  // The best price is already visible when a page swipe reveals this view.
  @State private var scales: [CGFloat] = [1, 0, 0]

  private var animates: Bool { isActive && !reduceMotion && appActive }

  var body: some View {
    GeometryReader { geometry in
      ZStack {
        ForEach(samples) { sample in
          SamplePricePill(price: sample.price, isBest: sample.id == bestID)
            .scaleEffect(scales[sample.id])
            .position(x: geometry.size.width * sample.x,
                      // Symmetric insets keep the spring overshoot in the band.
                      y: 26 + max(0, geometry.size.height - 52) * sample.y)
        }
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
      withoutAnimation {
        // Never blank the green chip during entry, backgrounding, or Reduce Motion.
        let showAll = reduceMotion || (isActive && !appActive)
        scales = samples.map { showAll || $0.id == bestID ? 1 : 0 }
      }
      guard animates else { return }
      do {
        // A small opening pulse keeps the green chip visible throughout its pop.
        withoutAnimation { scales[bestID] = 0.86 }
        await Task.yield()
        try Task.checkCancellation()
        withAnimation(.spring(response: 0.48, dampingFraction: 0.62)) { scales[bestID] = 1 }
        for id in samples.map(\.id) where id != bestID {
          try await Task.sleep(nanoseconds: 120_000_000)
          withAnimation(.spring(response: 0.48, dampingFraction: 0.62)) { scales[id] = 1 }
        }
        try await Task.sleep(nanoseconds: 1_600_000_000)
        var index = 0
        while !Task.isCancelled {
          withAnimation(.easeIn(duration: 0.32)) { scales[index] = 0 }
          try await Task.sleep(nanoseconds: 380_000_000)
          // Reserve the other capsules' cells and avoid the previous location.
          let occupied = Set(samples.map(\.cell))
          let nextCell = (0..<6).filter { !occupied.contains($0) }.randomElement()!
          withoutAnimation {
            samples[index] = Sample(id: index, cell: nextCell, isBest: index == bestID)
          }
          try await Task.sleep(nanoseconds: 50_000_000)
          withAnimation(.spring(response: 0.48, dampingFraction: 0.62)) { scales[index] = 1 }
          // Every chip takes a turn, including green. Price and position only
          // change at zero scale; the green identity never transfers or duplicates.
          try await Task.sleep(nanoseconds: 1_600_000_000)
          index = (index + 1) % samples.count
        }
      } catch { /* Leaving the page or backgrounding cancels the sequence. */ }
    }
  }

  private func withoutAnimation(_ update: () -> Void) {
    var transaction = Transaction(animation: nil)
    transaction.disablesAnimations = true
    withTransaction(transaction, update)
  }

  private struct Sample: Identifiable {
    let id: Int
    let cell: Int
    private let cents: Int
    var price: String { String(format: "$%.2f", Double(cents) / 100) }
    let x: CGFloat
    let y: CGFloat

    init(id: Int, cell: Int, isBest: Bool = false) {
      self.id = id
      self.cell = cell
      // Retain the existing illustrative $3.89–$4.72 window, with disjoint
      // ranges so the sole green price is strictly cheaper on every frame.
      cents = Int.random(in: isBest ? 389...419 : 420...472)
      // Keep the middle corridor clear for the sample-price caption.
      x = (cell.isMultiple(of: 2) ? 0.25 : 0.75) + CGFloat.random(in: -0.02...0.02)
      y = min(1, max(0, CGFloat(cell / 2) * 0.5 + CGFloat.random(in: -0.025...0.025)))
    }
  }
}

private struct SamplePricePill: View {
  let price: String
  let isBest: Bool

  @ViewBuilder var body: some View {
    if #available(iOS 26.0, *) {
      label.glassEffect(.regular.tint(isBest ? .green.opacity(0.3) : .clear), in: .capsule)
    } else {
      label.background(isBest ? Color.green.opacity(0.3) : Color(uiColor: .secondarySystemGroupedBackground), in: Capsule())
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
