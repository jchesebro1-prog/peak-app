import Capacitor
import UIKit
import Vision

/// Booth mode "Scan card": on-device text recognition with Apple Vision.
/// Input: a base64 JPEG. Output: the recognized lines, top to bottom.
@objc(CardTextPlugin)
public class CardTextPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CardTextPlugin"
    public let jsName = "CardText"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise)
    ]

    @objc func recognize(_ call: CAPPluginCall) {
        guard let b64 = call.getString("base64"),
              let data = Data(base64Encoded: b64),
              let image = UIImage(data: data),
              let cg = image.cgImage else {
            call.reject("Couldn't read that photo.")
            return
        }
        let request = VNRecognizeTextRequest { req, err in
            if let err = err {
                call.reject("Text recognition failed: \(err.localizedDescription)")
                return
            }
            let obs = (req.results as? [VNRecognizedTextObservation]) ?? []
            // Vision's origin is bottom-left: sort top-to-bottom, then left-to-right.
            let sorted = obs.sorted {
                abs($0.boundingBox.midY - $1.boundingBox.midY) > 0.01
                    ? $0.boundingBox.midY > $1.boundingBox.midY
                    : $0.boundingBox.minX < $1.boundingBox.minX
            }
            let lines = sorted.compactMap { $0.topCandidates(1).first?.string }
            call.resolve(["lines": lines])
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        let orientation = CGImagePropertyOrientation(rawValue: UInt32(image.imageOrientation.exifOrientation)) ?? .up
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try VNImageRequestHandler(cgImage: cg, orientation: orientation, options: [:]).perform([request])
            } catch {
                call.reject("Text recognition failed: \(error.localizedDescription)")
            }
        }
    }
}

private extension UIImage.Orientation {
    var exifOrientation: Int32 {
        switch self {
        case .up: return 1
        case .down: return 3
        case .left: return 8
        case .right: return 6
        case .upMirrored: return 2
        case .downMirrored: return 4
        case .leftMirrored: return 5
        case .rightMirrored: return 7
        @unknown default: return 1
        }
    }
}
