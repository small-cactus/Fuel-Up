import SwiftUI
import MapKit

// An illustrative neighborhood, never presented as the user's location or live prices.
struct OnboardingLocationIllustration: UIViewRepresentable {
  func makeCoordinator() -> Coordinator { Coordinator() }
  func makeUIView(context: Context) -> MKMapView {
    let map = MKMapView()
    map.delegate = context.coordinator
    map.isScrollEnabled = false; map.isZoomEnabled = false
    map.isRotateEnabled = false; map.isPitchEnabled = false
    map.showsCompass = false
    map.pointOfInterestFilter = .excludingAll
    let center = CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194)
    map.setRegion(MKCoordinateRegion(center: center, span: .init(latitudeDelta: 0.028, longitudeDelta: 0.035)), animated: false)
    let points = [(37.7749, -122.4194), (37.7802, -122.427), (37.769, -122.410)]
    map.addAnnotations(points.enumerated().map { index, point in
      let pin = MKPointAnnotation()
      pin.coordinate = .init(latitude: point.0, longitude: point.1)
      pin.title = index == 0 ? "A better stop" : "Gas station"
      return pin
    })
    return map
  }
  func updateUIView(_ view: MKMapView, context: Context) {}
  final class Coordinator: NSObject, MKMapViewDelegate {
    func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
      let pin = mapView.dequeueReusableAnnotationView(withIdentifier: "location-preview") as? MKMarkerAnnotationView
        ?? MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: "location-preview")
      pin.annotation = annotation
      pin.glyphImage = UIImage(systemName: "fuelpump.fill")
      pin.markerTintColor = annotation.title == "A better stop" ? .systemGreen : .systemBlue
      pin.titleVisibility = .visible
      pin.displayPriority = .required
      return pin
    }
  }
}
