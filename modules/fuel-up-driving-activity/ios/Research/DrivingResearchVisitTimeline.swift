import SwiftUI

// Newest stop first, with native shapes joining arrival and the preceding departure.
struct DrivingResearchVisitTimeline: View {
  let visits:[ResearchVisit]
  let labels:[String:String]
  let departures:[String:Double]
  let select:(ResearchVisit)->Void
  private var ordered:[ResearchVisit] {visits.sorted{$0.startedAt>$1.startedAt}}

  var body:some View {
    let stops=ordered
    VStack(alignment:.leading,spacing:0) {
      if stops.isEmpty {
        Label("No visits yet",systemImage:"fuelpump").foregroundStyle(.secondary).frame(minHeight:44)
      }
      ForEach(Array(stops.enumerated()),id:\.element.id) {index,visit in
        Button {select(visit)} label: {
          HStack(spacing:12) {
            DrivingResearchStationLogo(name:visit.station.name)
            VStack(alignment:.leading,spacing:4) {
              Text(visit.station.name).foregroundStyle(.primary)
              Text(ResearchConfirmation.title(for:labels[visit.id])).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength:8)
            Image(systemName:"chevron.right").font(.caption.bold()).foregroundStyle(.tertiary)
          }.frame(minHeight:44).padding(.vertical,6)
        }
        if index+1<stops.count {
          let previous=stops[index+1]
          let departure=departures[previous.id]
          VStack(spacing:0) {
            event("Arrived at \(visit.station.name)",at:visit.startedAt,top:false,bottom:departure != nil)
            if let departure {
              Rectangle().fill(.secondary.opacity(0.45)).frame(width:1.5,height:24)
                .frame(maxWidth:.infinity,alignment:.leading).padding(.leading,5.25)
              event("Left \(previous.station.name)",at:departure,top:true,bottom:false)
            }
          }.padding(.leading,16).padding(.vertical,4)
        }
      }
    }
  }
  private func event(_ title:String,at time:Double,top:Bool,bottom:Bool)->some View {
    Text("\(title) · \(Date(timeIntervalSince1970:time).formatted(date:.omitted,time:.shortened))")
      .font(.caption).foregroundStyle(.secondary)
      .frame(maxWidth:.infinity,alignment:.leading)
      .padding(.vertical,8).padding(.leading,22)
      .overlay(alignment:.leading) {
        GeometryReader {geometry in
          Path {path in
            let middle=geometry.size.height/2
            if top {path.move(to:CGPoint(x:6,y:0));path.addLine(to:CGPoint(x:6,y:middle-5))}
            if bottom {path.move(to:CGPoint(x:6,y:middle+5));path.addLine(to:CGPoint(x:6,y:geometry.size.height))}
          }.stroke(.secondary.opacity(0.45),lineWidth:1.5)
          Circle().stroke(.secondary,lineWidth:1.5).frame(width:10,height:10)
            .position(x:6,y:geometry.size.height/2)
        }.frame(width:12).accessibilityHidden(true)
      }
      .fixedSize(horizontal:false,vertical:true)
  }
}
