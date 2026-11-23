// Check the actual artwork pixels, not just the PNG's alpha-channel metadata.
//   images/toby-face.png  — freeform silhouette used as the DMG portrait
//   images/app-icon.png   — baked squircle app icon (avoids macOS 26 icon jail)
import AppKit

let root = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent()

func pixels(_ name: String) -> ([UInt8], Int, Int) {
    let data = try! Data(contentsOf: root.appendingPathComponent(name))
    guard let bitmap = NSBitmapImageRep(data: data), let image = bitmap.cgImage else {
        fatalError("Unable to decode \(name)")
    }
    let width = image.width
    let height = image.height
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    pixels.withUnsafeMutableBytes { buffer in
        let context = CGContext(
            data: buffer.baseAddress, width: width, height: height,
            bitsPerComponent: 8, bytesPerRow: width * 4,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )!
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    }
    return (pixels, width, height)
}

// MARK: - Freeform face silhouette (DMG portrait)

let (face, fw, fh) = pixels("images/toby-face.png")
precondition(fw == 1024 && fh == 1024, "Face artwork must be 1024×1024")
var minX = fw, minY = fh, maxX = 0, maxY = 0
var outlinePixels = 0
for y in 0..<fh {
    for x in 0..<fw {
        let index = (y * fw + x) * 4
        let alpha = Int(face[index + 3])
        guard alpha >= 128 else { continue }
        minX = min(minX, x); minY = min(minY, y)
        maxX = max(maxX, x); maxY = max(maxY, y)
        precondition(x > 0 && y > 0 && x < fw - 1 && y < fh - 1, "Clipped silhouette")
        let rgb = (0..<3).map { Double(face[index + $0]) / Double(alpha) }
        let neighbors = [index - 4, index + 4, index - fw * 4, index + fw * 4]
        if neighbors.contains(where: { face[$0 + 3] < 128 }) {
            precondition(rgb.allSatisfy { $0 > 0.96 }, "Outer outline is not white")
            outlinePixels += 1
        }
    }
}
let faceFillX = Double(maxX - minX + 1) / Double(fw)
let faceFillY = Double(maxY - minY + 1) / Double(fh)
precondition(faceFillX > 0.9 && faceFillY > 0.9, "Portrait does not fill the canvas")
precondition(outlinePixels > 1000, "Missing continuous silhouette outline")
print("Face artwork OK: \(outlinePixels) white perimeter pixels; \(Int(faceFillX * 100))% × \(Int(faceFillY * 100))% fill")

// MARK: - Baked squircle app icon (keeps macOS 26 from jailing it)

let (icon, iw, ih) = pixels("images/app-icon.png")
precondition(iw == 1024 && ih == 1024, "App icon must be 1024×1024")
for (x, y) in [(20, 20), (iw - 21, 20), (20, ih - 21), (iw - 21, ih - 21)] {
    precondition(icon[(y * iw + x) * 4 + 3] < 32, "Squircle corners must be transparent")
}
let center = (ih / 2 * iw + iw / 2) * 4
precondition(icon[center + 3] == 255, "Squircle center must be opaque")

// The plate must sit at the standard 824pt icon grid inside the 1024 canvas.
// Full-bleed plates get scaled into macOS 26's gray icon jail instead.
var pMinX = iw, pMinY = ih, pMaxX = 0, pMaxY = 0
for y in 0..<ih {
    for x in 0..<iw where icon[(y * iw + x) * 4 + 3] >= 250 {
        pMinX = min(pMinX, x); pMinY = min(pMinY, y)
        pMaxX = max(pMaxX, x); pMaxY = max(pMaxY, y)
    }
}
let plateSize = max(pMaxX - pMinX + 1, pMaxY - pMinY + 1)
precondition((810...840).contains(plateSize), "Squircle must use the 824pt icon grid, got \(plateSize)")
precondition(pMinX >= 90 && pMinY >= 90, "Squircle must keep the transparent icon margin")

// The plate must be a dark navy (so the white outline reads on dark backgrounds)
// and cover almost the whole canvas edge-to-edge through the middle rows.
var platePixels = 0, creamPixels = 0, whiteRingPixels = 0
for y in 0..<ih {
    for x in 0..<iw {
        let index = (y * iw + x) * 4
        let alpha = Int(icon[index + 3])
        guard alpha >= 250 else { continue }
        let r = Double(icon[index]), g = Double(icon[index + 1]), b = Double(icon[index + 2])
        if b > r && b > 30 && r < 60 && g < 80 { platePixels += 1 }
        if r > 235 && g > 230 && b > 220 { creamPixels += 1 }
        if r > 245 && g > 245 && b > 245 { whiteRingPixels += 1 }
    }
}
precondition(platePixels > 300_000, "Dark squircle plate missing")
precondition(creamPixels > 100_000, "Toby face fill missing")
precondition(whiteRingPixels > 5000, "White face outline missing")

// No orange anywhere: the old plate color must be gone.
for index in stride(from: 0, to: icon.count, by: 4) where icon[index + 3] > 200 {
    let r = Int(icon[index]), g = Int(icon[index + 1]), b = Int(icon[index + 2])
    precondition(!(r > 180 && g < 180 && b < 90), "Orange plate returned")
}
print("App icon OK: \(platePixels) navy plate, \(creamPixels) cream face, \(whiteRingPixels) white outline pixels")
