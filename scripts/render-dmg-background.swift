// Rebuild the checked-in 1×/2× installer artwork with native macOS typography.
// The canvas matches the DMG window's content area (the window is 800×460, of
// which the title bar takes 60), so Finder shows the artwork without clipping.
// Usage: swift scripts/render-dmg-background.swift
import AppKit

let root = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent()
guard let portrait = NSImage(contentsOf: root.appendingPathComponent("images/toby-face.png")) else {
    fatalError("Missing images/toby-face.png")
}

let width = 800
let height = 400
for scale in [1, 2] {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: width * scale,
        pixelsHigh: height * scale,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        fatalError("Unable to create background bitmap")
    }
    bitmap.size = NSSize(width: width, height: height)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.cgContext.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
    context.imageInterpolation = .high

    NSColor(srgbRed: 0.96, green: 0.96, blue: 0.97, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: width, height: height).fill()
    let ink = NSColor(srgbRed: 0.063, green: 0.125, blue: 0.208, alpha: 1)
    let secondary = NSColor(srgbRed: 0.34, green: 0.37, blue: 0.42, alpha: 1)

    ("Install Toby" as NSString).draw(
        at: NSPoint(x: 48, y: 336),
        withAttributes: [.font: NSFont.systemFont(ofSize: 28, weight: .semibold), .foregroundColor: ink]
    )
    ("Drag Toby into Applications." as NSString).draw(
        at: NSPoint(x: 48, y: 312),
        withAttributes: [.font: NSFont.systemFont(ofSize: 14), .foregroundColor: secondary]
    )

    // Align the arrow with Finder's icon centers at y = 250 from the top.
    ink.withAlphaComponent(0.55).setStroke()
    let arrow = NSBezierPath()
    arrow.lineWidth = 3
    arrow.lineCapStyle = .round
    arrow.lineJoinStyle = .round
    arrow.move(to: NSPoint(x: 186, y: 150))
    arrow.line(to: NSPoint(x: 254, y: 150))
    arrow.move(to: NSPoint(x: 242, y: 162))
    arrow.line(to: NSPoint(x: 254, y: 150))
    arrow.line(to: NSPoint(x: 242, y: 138))
    arrow.stroke()

    portrait.draw(in: NSRect(x: 440, y: 45, width: 320, height: 320))
    NSGraphicsContext.restoreGraphicsState()

    let suffix = scale == 1 ? "" : "@2x"
    let output = root.appendingPathComponent("images/dmg-background\(suffix).png")
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("Unable to encode background PNG")
    }
    try png.write(to: output)
    print("Rendered \(output.path)")
}
