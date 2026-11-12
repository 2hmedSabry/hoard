// hoard-vision: on-device image analysis with Apple's Vision framework.
// Usage: hoard-vision <image> [<image> ...]
// Prints one JSON object per line: labels, recognised text and a feature print.
import Foundation
import Vision

struct Label: Codable { let id: String; let confidence: Float }
struct Result: Codable {
    let path: String
    var labels: [Label] = []
    var text: String = ""
    var feature: String? = nil   // base64 little-endian Float32
    var error: String? = nil
}

func analyze(_ path: String) -> Result {
    var r = Result(path: path)
    let url = URL(fileURLWithPath: path)
    let handler = VNImageRequestHandler(url: url, options: [:])

    let classify = VNClassifyImageRequest()
    let text = VNRecognizeTextRequest()
    text.recognitionLevel = .accurate
    text.usesLanguageCorrection = true
    if #available(macOS 13.0, *) { text.automaticallyDetectsLanguage = true }
    let supported = (try? text.supportedRecognitionLanguages()) ?? []
    text.recognitionLanguages = ["en-US", "ar-SA", "fr-FR", "de-DE", "es-ES"].filter { supported.contains($0) }
    let feature = VNGenerateImageFeaturePrintRequest()

    do {
        try handler.perform([classify, text, feature])
    } catch {
        r.error = error.localizedDescription
        return r
    }
    if let obs = classify.results {
        r.labels = obs.filter { $0.confidence >= 0.25 && $0.identifier != "others" }
            .prefix(12).map { Label(id: $0.identifier, confidence: $0.confidence) }
    }
    if let lines = text.results {
        r.text = lines.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }
    if let fp = feature.results?.first, fp.elementType == .float {
        r.feature = fp.data.base64EncodedString()
    }
    return r
}

let enc = JSONEncoder()
for path in CommandLine.arguments.dropFirst() {
    let r = autoreleasepool { analyze(path) }
    if let d = try? enc.encode(r), let s = String(data: d, encoding: .utf8) {
        print(s)
        fflush(stdout)
    }
}
