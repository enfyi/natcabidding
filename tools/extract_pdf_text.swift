import Foundation
import PDFKit
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count >= 3 else {
    fputs("Usage: extract_pdf_text.swift <input.pdf> <output.txt>\n", stderr)
    exit(2)
}

let inputURL = URL(fileURLWithPath: args[1])
let outputURL = URL(fileURLWithPath: args[2])

guard let document = PDFDocument(url: inputURL) else {
    fputs("Could not open PDF: \(args[1])\n", stderr)
    exit(1)
}

func cgImage(from image: NSImage) -> CGImage? {
    var rect = CGRect(origin: .zero, size: image.size)
    return image.cgImage(forProposedRect: &rect, context: nil, hints: nil)
}

func ocr(_ image: CGImage) -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.minimumTextHeight = 0.012
    request.recognitionLanguages = ["en-US"]

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do {
        try handler.perform([request])
    } catch {
        return ""
    }

    let observations = request.results ?? []
    return observations.compactMap { observation in
        observation.topCandidates(1).first?.string
    }.joined(separator: "\n")
}

var output = ""

for index in 0..<document.pageCount {
    guard let page = document.page(at: index) else { continue }
    output += "\n\n===== PAGE \(index + 1) =====\n"

    let embedded = page.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if embedded.count > 40 {
        output += embedded + "\n"
        continue
    }

    let bounds = page.bounds(for: .mediaBox)
    let scale: CGFloat = 2.2
    let imageSize = CGSize(width: bounds.width * scale, height: bounds.height * scale)
    let image = NSImage(size: imageSize)

    image.lockFocus()
    NSColor.white.set()
    NSBezierPath(rect: NSRect(origin: .zero, size: imageSize)).fill()

    if let context = NSGraphicsContext.current?.cgContext {
        context.saveGState()
        context.scaleBy(x: scale, y: scale)
        page.draw(with: .mediaBox, to: context)
        context.restoreGState()
    }
    image.unlockFocus()

    if let rendered = cgImage(from: image) {
        output += ocr(rendered) + "\n"
    }
}

try output.write(to: outputURL, atomically: true, encoding: .utf8)
print("Wrote \(document.pageCount) pages to \(outputURL.path)")
