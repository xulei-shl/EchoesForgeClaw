import AppKit
import Foundation
import Vision

struct TextBox: Codable {
  let text: String
  let confidence: Float
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct OCRResult: Codable {
  let path: String
  let texts: [TextBox]
}

func cgImage(from path: String) -> CGImage? {
  let url = URL(fileURLWithPath: path)
  guard let image = NSImage(contentsOf: url) else { return nil }
  var rect = NSRect(origin: .zero, size: image.size)
  return image.cgImage(forProposedRect: &rect, context: nil, hints: nil)
}

func recognize(path: String) throws -> OCRResult {
  guard let image = cgImage(from: path) else {
    return OCRResult(path: path, texts: [])
  }

  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.recognitionLanguages = ["zh-Hans", "en-US"]
  request.usesLanguageCorrection = false
  request.minimumTextHeight = 0.012

  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  try handler.perform([request])

  let boxes = (request.results ?? []).compactMap { observation -> TextBox? in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    let box = observation.boundingBox
    return TextBox(
      text: candidate.string,
      confidence: candidate.confidence,
      x: Double(box.origin.x),
      y: Double(box.origin.y),
      width: Double(box.size.width),
      height: Double(box.size.height)
    )
  }

  return OCRResult(path: path, texts: boxes)
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.withoutEscapingSlashes]

for path in CommandLine.arguments.dropFirst() {
  do {
    let result = try recognize(path: path)
    let data = try encoder.encode(result)
    if let line = String(data: data, encoding: .utf8) {
      print(line)
    }
  } catch {
    let result = OCRResult(path: path, texts: [])
    let data = try encoder.encode(result)
    if let line = String(data: data, encoding: .utf8) {
      print(line)
    }
  }
}
