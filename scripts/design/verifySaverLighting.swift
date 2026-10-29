import Foundation
import Metal

// Execute the production shader into an HDR floating-point target. Screenshots
// cannot prove EDR values, so inspect the actual GPU pixels before compositing.
let sourcePath = "modules/fuel-up-glass/ios/SuperSaverMetalShader.swift"
let file = try String(contentsOfFile: sourcePath, encoding: .utf8)
let source = String(file.components(separatedBy: "\"\"\"")[1])
let device = MTLCreateSystemDefaultDevice()!
let library = try device.makeLibrary(source: source, options: nil)
let descriptor = MTLRenderPipelineDescriptor()
descriptor.vertexFunction = library.makeFunction(name: "saverVertex")
descriptor.fragmentFunction = library.makeFunction(name: "saverFragment")
descriptor.colorAttachments[0].pixelFormat = .rgba16Float
let pipeline = try device.makeRenderPipelineState(descriptor: descriptor)
let queue = device.makeCommandQueue()!
let w = 360, h = 780
let aspect = Float(w)/Float(h)
let outputDescriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba16Float, width: w, height: h, mipmapped: false)
outputDescriptor.storageMode = .shared
outputDescriptor.usage = [.shaderRead, .renderTarget]
let output = device.makeTexture(descriptor: outputDescriptor)!
func atlas(tile: Int?) -> MTLTexture {
  let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm, width: w, height: h, mipmapped: false)
  d.storageMode = .shared; d.usage = .shaderRead
  let texture = device.makeTexture(descriptor: d)!
  var bytes = [UInt8](repeating: 0, count: w*h*4)
  if let tile {
    for y in (tile*h/2)..<((tile+1)*h/2) {
      for x in 0..<w { for c in 0..<4 { bytes[(y*w+x)*4+c] = 255 } }
    }
  }
  bytes.withUnsafeBytes { texture.replace(region: MTLRegionMake2D(0,0,w,h),mipmapLevel:0,withBytes:$0.baseAddress!,bytesPerRow:w*4) }
  return texture
}
let atlases = [atlas(tile:nil), atlas(tile:0), atlas(tile:1)]
var gpuTimes: [Double] = []
func render(tile: Int?, width: Float = 0.85, mode: Float = 0, headroom: Float = 3, brand: Bool = false, time: Float = 0) -> [Float] {
  let pass = MTLRenderPassDescriptor()
  pass.colorAttachments[0].texture = output
  pass.colorAttachments[0].loadAction = .clear
  pass.colorAttachments[0].storeAction = .store
  let command = queue.makeCommandBuffer()!
  let encoder = command.makeRenderCommandEncoder(descriptor: pass)!
  let bounds = SIMD4<Float>(0.36,0.70,0.64,0.75), absent = SIMD4<Float>(-2,-2,-2,-2)
  let uniforms = [SIMD4<Float>(time,1,mode,aspect),SIMD4<Float>(0,0,1,1),
    SIMD4<Float>(0.5-width/2,0.82,width,0.075),SIMD4<Float>(Float(w),Float(h),Float(w),Float(h)),
    tile == 0 ? bounds : absent, tile == 1 ? bounds : absent,
    SIMD4<Float>(headroom,brand ? 1 : 0,0,0)]
  encoder.setRenderPipelineState(pipeline)
  uniforms.withUnsafeBytes { encoder.setFragmentBytes($0.baseAddress!,length:$0.count,index:0) }
  encoder.setFragmentTexture(atlases[(tile ?? -1)+1],index:0)
  encoder.drawPrimitives(type:.triangle,vertexStart:0,vertexCount:3)
  encoder.endEncoding();command.commit();command.waitUntilCompleted()
  gpuTimes.append((command.gpuEndTime-command.gpuStartTime)*1000)
  if let error = command.error { fatalError("Metal command failed: \(error)") }
  var bits = [UInt16](repeating:0,count:w*h*4)
  bits.withUnsafeMutableBytes { output.getBytes($0.baseAddress!,bytesPerRow:w*8,from:MTLRegionMake2D(0,0,w,h),mipmapLevel:0) }
  let pixels = bits.map { Float(Float16(bitPattern:$0)) }
  precondition(pixels.allSatisfy { $0.isFinite && $0 >= 0 }, "Nonfinite or negative output")
  return pixels
}
func shadowMetrics(_ full: [Float], _ shadow: [Float]) -> [String:Double] {
  var count=0.0, maximum=0.0, weightedDistance=0.0, totalLoss=0.0
  for y in Int(Float(h)*0.55)..<Int(Float(h)*0.70) {
    for x in Int(Float(w)*0.15)..<Int(Float(w)*0.85) {
      let i=(y*w+x)*4
      let loss=Double((full[i]+full[i+1]+full[i+2]-shadow[i]-shadow[i+1]-shadow[i+2])/3)
      if loss>0.0005 {
        count+=1; totalLoss+=loss; maximum=max(maximum,loss)
        weightedDistance+=loss*(Double(h)*0.70-Double(y))
      }
    }
  }
  return ["pixels":count,"maxLinearLoss":maximum,"meanDistancePixels":weightedDistance/max(totalLoss,0.00001)]
}
let unblocked=render(tile:nil), price=render(tile:0), title=render(tile:1)
let priceShadow=shadowMetrics(unblocked,price), titleShadow=shadowMetrics(unblocked,title)
precondition(priceShadow["pixels"]!>5 && titleShadow["pixels"]!>5, "Both extrusions must cast shadows")
precondition(titleShadow["meanDistancePixels"]!>priceShadow["meanDistancePixels"]!*1.5, "Price shadow must be substantially tighter than title shadow at matched geometry")
let narrow=render(tile:1,width:0.04)
let emitterDifference=zip(title,narrow).reduce(0.0) { $0+Double(abs($1.0-$1.1)) }
precondition(emitterDifference>100, "Actual emitter area must affect transport")
var brands:[[String:Any]]=[]
for mode:Float in [1,2] {
  var minimumPeak=Float.greatestFiniteMagnitude, maximumPeak:Float=0
  for time in stride(from:Float(0),to:8,by:0.5) {
    let pixels=render(tile:1,mode:mode,brand:true,time:time)
    var brightest:Float=0, dimmest=Float.greatestFiniteMagnitude
    for i in stride(from:0,to:pixels.count,by:4) where pixels[i+3]>0.99 {
      let peak=max(pixels[i],max(pixels[i+1],pixels[i+2]))
      brightest=max(brightest,peak); dimmest=min(dimmest,peak)
    }
    precondition(dimmest>1.01 && brightest<=3.001, "Brand must retain HDR through its animation within display headroom")
    minimumPeak=min(minimumPeak,dimmest);maximumPeak=max(maximumPeak,brightest)
  }
  let sdr=render(tile:1,mode:mode,headroom:1,brand:true)
  precondition(sdr.max()!<=1.001,"SDR fallback must stay in range")
  brands.append(["surface":mode==1 ? "Fuel Up":"Super Saver","minimumOpaquePixelPeak":minimumPeak,"maximumPeak":maximumPeak,"phasesChecked":16,"SDRFallbackPassed":true])
}
let result:[String:Any] = ["device":device.name,"pixelFormat":"rgba16Float","shader":sourcePath,
 "priceShadow":priceShadow,"titleShadow":titleShadow,"fullVsNarrowEmitterDifference":emitterDifference,
 "HDRBrandChecks":brands,"offscreenGPUFrameMilliseconds":gpuTimes]
let data = try JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys])
print(String(data:data,encoding:.utf8)!)
