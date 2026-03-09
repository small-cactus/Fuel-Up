import Foundation
import MapKit

struct CoordinatePair {
  let origin: CLLocationCoordinate2D
  let destination: CLLocationCoordinate2D
}

func parseCoordinatePair() -> CoordinatePair {
  let arguments = CommandLine.arguments.dropFirst()

  guard arguments.count == 4,
        let originLatitude = Double(arguments[arguments.startIndex]),
        let originLongitude = Double(arguments[arguments.index(arguments.startIndex, offsetBy: 1)]),
        let destinationLatitude = Double(arguments[arguments.index(arguments.startIndex, offsetBy: 2)]),
        let destinationLongitude = Double(arguments[arguments.index(arguments.startIndex, offsetBy: 3)]) else {
    return CoordinatePair(
      origin: CLLocationCoordinate2D(latitude: 37.7931, longitude: -122.3959),
      destination: CLLocationCoordinate2D(latitude: 37.7745, longitude: -122.4041)
    )
  }

  return CoordinatePair(
    origin: CLLocationCoordinate2D(latitude: originLatitude, longitude: originLongitude),
    destination: CLLocationCoordinate2D(latitude: destinationLatitude, longitude: destinationLongitude)
  )
}

func mapItem(from coordinate: CLLocationCoordinate2D) -> MKMapItem {
  let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
  return MKMapItem(location: location, address: nil)
}

func coordinatesPayload(from polyline: MKPolyline) -> [CLLocationCoordinate2D] {
  var coordinates = Array(
    repeating: CLLocationCoordinate2D(latitude: 0, longitude: 0),
    count: polyline.pointCount
  )
  polyline.getCoordinates(&coordinates, range: NSRange(location: 0, length: polyline.pointCount))
  return coordinates
}

let pair = parseCoordinatePair()
let request = MKDirections.Request()
request.source = mapItem(from: pair.origin)
request.destination = mapItem(from: pair.destination)
request.transportType = .automobile
request.requestsAlternateRoutes = false

MKDirections(request: request).calculate { response, error in
  defer { exit(0) }

  if let error {
    fputs("ERROR: \(error.localizedDescription)\n", stderr)
    return
  }

  guard let route = response?.routes.first else {
    fputs("ERROR: MapKit did not return a route.\n", stderr)
    return
  }

  let coordinates = coordinatesPayload(from: route.polyline)
  print("distanceMeters=\(Int(route.distance.rounded()))")
  print("expectedTravelTimeSeconds=\(Int(route.expectedTravelTime.rounded()))")
  print("pointCount=\(coordinates.count)")
  print("coordinates=[")
  for coordinate in coordinates {
    print(String(format: "  { latitude: %.6f, longitude: %.6f },", coordinate.latitude, coordinate.longitude))
  }
  print("]")
}

RunLoop.main.run(until: Date().addingTimeInterval(20))
