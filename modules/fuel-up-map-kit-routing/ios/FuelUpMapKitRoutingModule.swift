import ExpoModulesCore
import Foundation
import MapKit

internal final class MissingCoordinateFieldException: Exception {
  override var reason: String {
    "Route coordinate payload is missing latitude or longitude."
  }

  override var code: String {
    "ERR_INVALID_ROUTE_COORDINATE"
  }
}

internal final class RouteUnavailableException: Exception {
  private let details: String

  init(_ details: String) {
    self.details = details
    super.init()
  }

  override var reason: String {
    details
  }

  override var code: String {
    "ERR_ROUTE_UNAVAILABLE"
  }
}

public final class FuelUpMapKitRoutingModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FuelUpMapKitRouting")

    AsyncFunction("openDrivingDirectionsInMapsAsync") { (destination: [String: Any], promise: Promise) in
      DispatchQueue.main.async {
        do {
          let destinationItem = try mapItem(from: destination)
          let didOpen = destinationItem.openInMaps(launchOptions: [
            MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving
          ])

          if didOpen {
            promise.resolve(["opened": true])
            return
          }

          promise.reject(RouteUnavailableException("Maps app declined the destination handoff."))
        } catch {
          promise.reject(error)
        }
      }
    }

    AsyncFunction("getDrivingRouteAsync") { (origin: [String: Any], destination: [String: Any], promise: Promise) in
      DispatchQueue.main.async {
        do {
          let request = MKDirections.Request()
          request.source = try mapItem(from: origin)
          request.destination = try mapItem(from: destination)
          request.transportType = .automobile
          request.requestsAlternateRoutes = false

          let directions = MKDirections(request: request)
          directions.calculate { response, error in
            if let error {
              promise.reject(RouteUnavailableException(error.localizedDescription))
              return
            }

            guard let route = response?.routes.first else {
              promise.reject(RouteUnavailableException("MapKit did not return a drivable route."))
              return
            }

            promise.resolve([
              "coordinates": coordinatesPayload(from: route.polyline),
              "distanceMeters": route.distance,
              "expectedTravelTimeSeconds": route.expectedTravelTime,
              "steps": route.steps.compactMap(stepPayload(from:))
            ])
          }
        } catch {
          promise.reject(error)
        }
      }
    }
  }
}

private func mapItem(from payload: [String: Any]) throws -> MKMapItem {
  guard
    let latitude = payload["latitude"] as? CLLocationDegrees,
    let longitude = payload["longitude"] as? CLLocationDegrees
  else {
    throw MissingCoordinateFieldException()
  }

  let coordinate = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
  let placemark = MKPlacemark(coordinate: coordinate)
  let mapItem = MKMapItem(placemark: placemark)

  if let name = payload["name"] as? String {
    let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmedName.isEmpty {
      mapItem.name = trimmedName
    }
  }

  return mapItem
}

private func coordinatesPayload(from polyline: MKPolyline) -> [[String: CLLocationDegrees]] {
  var coordinates = Array(
    repeating: CLLocationCoordinate2D(latitude: 0, longitude: 0),
    count: polyline.pointCount
  )
  polyline.getCoordinates(&coordinates, range: NSRange(location: 0, length: polyline.pointCount))

  return coordinates.map { coordinate in
    [
      "latitude": coordinate.latitude,
      "longitude": coordinate.longitude
    ]
  }
}

private func stepPayload(from step: MKRoute.Step) -> [String: Any]? {
  let coordinates = coordinatesPayload(from: step.polyline)

  guard let firstCoordinate = coordinates.first else {
    return nil
  }

  return [
    "instructions": step.instructions,
    "distanceMeters": step.distance,
    "expectedTravelTimeSeconds": step.distance > 0 ? step.distance / 13.4 : 0,
    "coordinate": firstCoordinate,
    "coordinates": coordinates
  ]
}
