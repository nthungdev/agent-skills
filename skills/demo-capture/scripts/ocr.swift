// OCR verification for captured screenshots using macOS Vision.
//
// Build once:
//   swiftc -o /tmp/ocr <skill-path>/scripts/ocr.swift
//
// Run:
//   /tmp/ocr tmp/demos/<ticket>/*.png

import AppKit
import Foundation
import Vision

let args = CommandLine.arguments.dropFirst()
guard !args.isEmpty else {
    FileHandle.standardError.write("usage: ocr <image> [<image> ...]\n".data(using: .utf8)!)
    exit(2)
}

for imagePath in args {
    guard
        let image = NSImage(contentsOfFile: imagePath),
        let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
    else {
        FileHandle.standardError.write("cannot read: \(imagePath)\n".data(using: .utf8)!)
        continue
    }

    print("=== \(imagePath) ===")

    let request = VNRecognizeTextRequest { request, error in
        if let error {
            FileHandle.standardError.write("ocr error: \(error)\n".data(using: .utf8)!)
            return
        }
        guard let observations = request.results as? [VNRecognizedTextObservation] else {
            return
        }
        for observation in observations {
            if let candidate = observation.topCandidates(1).first {
                print(candidate.string)
            }
        }
    }
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try? handler.perform([request])
}
