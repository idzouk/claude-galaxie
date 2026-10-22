// Mini-planète flottante : reste au premier plan sur tous les bureaux et montre où en est Claude Code.
// Elle lit ~/.claude/galaxie-etat.json, écrit par le mod « galaxie ».
//   travail : couleur de l'action en cours, des comètes tournent autour
//   pret    : la réponse est prête, bouquet puis lueur verte jusqu'à la prochaine demande
//   veille / hors ligne : planète éteinte
// Glisser pour déplacer, clic droit pour quitter. `--snapshot <etat> <fichier.png>` rend une image et sort.

import AppKit

struct Etat: Decodable {
    var etat: String
    var couleur: String
    var n: Int
    var fin: Double
    var t: Double
}

let fichier = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude/galaxie-etat.json")
let taille: CGFloat = 140

func couleurHex(_ s: String) -> (CGFloat, CGFloat, CGFloat) {
    let v = Int(s.dropFirst(), radix: 16) ?? 0x8a8fa3
    return (CGFloat((v >> 16) & 255) / 255, CGFloat((v >> 8) & 255) / 255, CGFloat(v & 255) / 255)
}

func maintenantMs() -> Double { Date().timeIntervalSince1970 * 1000 }

final class VuePlanete: NSView {
    var etat = Etat(etat: "veille", couleur: "#8a8fa3", n: 0, fin: 0, t: 0)
    var rgb: (CGFloat, CGFloat, CGFloat) = (0.54, 0.56, 0.64)
    var phase: CGFloat = 0
    var vitesse: CGFloat = 0.01
    var finVue: Double = 0
    var debutBouquet: Double = 0
    var eclats: [(angle: CGFloat, force: CGFloat, teinte: Int)] = []
    let palette: [(CGFloat, CGFloat, CGFloat)] = [(1, 0.84, 0.42), (0.13, 0.65, 0.35), (0.95, 0.96, 1), (0.75, 0.38, 1), (0.29, 0.62, 1)]

    override var isFlipped: Bool { false }
    override var acceptsFirstResponder: Bool { true }

    func lire() {
        guard let data = try? Data(contentsOf: fichier), let e = try? JSONDecoder().decode(Etat.self, from: data) else { return }
        etat = e
    }

    func avancer() {
        let horsLigne = maintenantMs() - etat.t > 15_000
        // même couleur que le panneau Galaxie ; gris seulement quand Claude Code ne répond plus
        let cible: (CGFloat, CGFloat, CGFloat) = horsLigne ? (0.42, 0.44, 0.55) : couleurHex(etat.couleur)
        rgb = (rgb.0 + (cible.0 - rgb.0) * 0.12, rgb.1 + (cible.1 - rgb.1) * 0.12, rgb.2 + (cible.2 - rgb.2) * 0.12)
        let cibleVitesse: CGFloat = etat.etat == "travail" && !horsLigne ? 0.06 : 0.012
        vitesse += (cibleVitesse - vitesse) * 0.05
        phase += vitesse
        // une nouvelle fin de réponse : on lance le bouquet
        if etat.fin > finVue {
            finVue = etat.fin
            if maintenantMs() - etat.fin < 5_000 {
                debutBouquet = maintenantMs()
                eclats = (0..<46).map { i in (CGFloat.random(in: 0..<(.pi * 2)), CGFloat.random(in: 0.5...1.3), i % 5) }
            }
        }
        needsDisplay = true
    }

    func couleur(_ c: (CGFloat, CGFloat, CGFloat), _ a: CGFloat = 1, clair k: CGFloat = 0) -> NSColor {
        NSColor(srgbRed: c.0 + (1 - c.0) * k, green: c.1 + (1 - c.1) * k, blue: c.2 + (1 - c.2) * k, alpha: a)
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.clear.set()
        bounds.fill()
        let horsLigne = maintenantMs() - etat.t > 15_000
        let travail = etat.etat == "travail" && !horsLigne
        let pret = etat.etat == "pret" && !horsLigne
        let cx = bounds.midX, cy = bounds.midY + 4
        let bouquet = max(0, 1 - CGFloat((maintenantMs() - debutBouquet) / 2600))
        let r: CGFloat = 26 * (1 + bouquet * 0.14 * sin(bouquet * .pi))
        let alpha: CGFloat = horsLigne ? 0.45 : 1

        // lueur : pulse au travail, respire quand c'est prêt
        let pulse = travail ? 0.32 + 0.16 * sin(phase * 2.2) : pret ? 0.22 + 0.14 * sin(phase * 4) : 0.08
        if let g = NSGradient(starting: couleur(rgb, pulse * alpha), ending: couleur(rgb, 0)) {
            let rg = r * 2.1
            g.draw(in: NSBezierPath(ovalIn: NSRect(x: cx - rg, y: cy - rg, width: rg * 2, height: rg * 2)), relativeCenterPosition: .zero)
        }

        let anneau = NSRect(x: cx - r * 1.75, y: cy - r * 0.42, width: r * 3.5, height: r * 0.84)
        func dessinerAnneau(devant: Bool) {
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(rect: devant ? NSRect(x: 0, y: 0, width: bounds.width, height: cy) : NSRect(x: 0, y: cy, width: bounds.width, height: bounds.height)).addClip()
            let p = NSBezierPath(ovalIn: anneau)
            p.lineWidth = 3.2
            couleur(rgb, 0.75 * alpha, clair: 0.35).setStroke()
            p.stroke()
            let p2 = NSBezierPath(ovalIn: anneau.insetBy(dx: 6, dy: 1.8))
            p2.lineWidth = 1.2
            couleur(rgb, 0.45 * alpha, clair: 0.5).setStroke()
            p2.stroke()
            NSGraphicsContext.restoreGraphicsState()
        }
        dessinerAnneau(devant: false)

        // la planète : dégradé éclairé en haut à gauche, bandes qui défilent
        let corps = NSBezierPath(ovalIn: NSRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))
        let dense = couleur((rgb.0 * 0.22, rgb.1 * 0.22, rgb.2 * 0.22), alpha)
        if let g = NSGradient(colors: [couleur(rgb, alpha, clair: 0.45), couleur(rgb, alpha), dense], atLocations: [0, 0.45, 1], colorSpace: .sRGB) {
            g.draw(in: corps, relativeCenterPosition: NSPoint(x: -0.35, y: 0.4))
        }
        NSGraphicsContext.saveGraphicsState()
        corps.addClip()
        for i in 0..<4 {
            let y = cy - r + CGFloat(i) * r * 0.55 + sin(phase + CGFloat(i)) * 2.5
            couleur(rgb, 0.13 * alpha, clair: i % 2 == 0 ? 0.5 : 0).setFill()
            NSBezierPath(ovalIn: NSRect(x: cx - r * 1.3 + sin(phase * 0.7 + CGFloat(i)) * 6, y: y, width: r * 2.6, height: r * 0.22)).fill()
        }
        NSGraphicsContext.restoreGraphicsState()
        dessinerAnneau(devant: true)

        // comètes : une par action en cours
        if travail {
            let n = max(1, min(etat.n, 4))
            for i in 0..<n {
                let base = phase * 1.6 + CGFloat(i) * (.pi * 2 / CGFloat(n))
                for j in stride(from: 12, through: 0, by: -1) {
                    let a = base - CGFloat(j) * 0.09
                    let x = cx + cos(a) * r * 2.05, y = cy + sin(a) * r * 0.62
                    let k = 1 - CGFloat(j) / 13
                    let s: CGFloat = j == 0 ? 4.2 : 2.6 * k + 0.6
                    (j == 0 ? NSColor.white : couleur(rgb, k * 0.9, clair: 0.25)).setFill()
                    NSBezierPath(ovalIn: NSRect(x: x - s / 2, y: y - s / 2, width: s, height: s)).fill()
                }
            }
        }

        // le bouquet de fin de réponse : deux ondes et des éclats
        if bouquet > 0 {
            let e = 1 - bouquet
            for (i, teinte) in [(0, palette[1]), (1, palette[0])] {
                let rr = r * (1.1 + e * (1.6 + CGFloat(i) * 0.5))
                let p = NSBezierPath(ovalIn: NSRect(x: cx - rr, y: cy - rr * 0.8, width: rr * 2, height: rr * 1.6))
                p.lineWidth = 2.5
                couleur(teinte, bouquet * 0.9).setStroke()
                p.stroke()
            }
            for eclat in eclats {
                let d = r * 0.9 + e * eclat.force * 52
                let x = cx + cos(eclat.angle) * d, y = cy + sin(eclat.angle) * d * 0.85 - e * e * 18
                couleur(palette[eclat.teinte], bouquet).setFill()
                NSBezierPath(ovalIn: NSRect(x: x - 1.8, y: y - 1.8, width: 3.6, height: 3.6)).fill()
            }
        }
    }

    override func mouseDown(with event: NSEvent) { window?.performDrag(with: event) }

    override func rightMouseDown(with event: NSEvent) {
        let menu = NSMenu()
        menu.addItem(withTitle: "Quitter la mini-planète", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        NSMenu.popUpContextMenu(menu, with: event, for: self)
    }
}

// --- rendu d'une image pour vérifier sans écran : --snapshot <travail|pret|veille> <fichier.png>
let args = CommandLine.arguments
if args.count >= 4, args[1] == "--snapshot" {
    let vue = VuePlanete(frame: NSRect(x: 0, y: 0, width: taille, height: taille))
    let couleurs = ["travail": "#f28a2e", "pret": "#22a55a", "veille": "#8a8fa3"]
    vue.etat = Etat(etat: args[2], couleur: couleurs[args[2]] ?? "#8a8fa3", n: 2, fin: 0, t: maintenantMs())
    for _ in 0..<80 { vue.avancer() }
    if args[2] == "pret" {
        vue.debutBouquet = maintenantMs() - 700
        vue.eclats = (0..<46).map { i in (CGFloat.random(in: 0..<(.pi * 2)), CGFloat.random(in: 0.5...1.3), i % 5) }
    }
    let rep = vue.bitmapImageRepForCachingDisplay(in: vue.bounds)!
    vue.cacheDisplay(in: vue.bounds, to: rep)
    try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: args[3]))
    exit(0)
}

// --- la fenêtre flottante ---
let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let panneau = NSPanel(contentRect: NSRect(x: 0, y: 0, width: taille, height: taille),
                      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
panneau.isOpaque = false
panneau.backgroundColor = .clear
panneau.hasShadow = false
panneau.level = .statusBar
panneau.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
panneau.isMovableByWindowBackground = true
panneau.hidesOnDeactivate = false
let vue = VuePlanete(frame: panneau.contentRect(forFrameRect: panneau.frame))
panneau.contentView = vue
if !panneau.setFrameUsingName("GalaxieMiniPlanete"), let ecran = NSScreen.main {
    let f = ecran.visibleFrame
    panneau.setFrameOrigin(NSPoint(x: f.maxX - taille - 24, y: f.maxY - taille - 24))
}
panneau.setFrameAutosaveName("GalaxieMiniPlanete")
panneau.orderFrontRegardless()

var compteur = 0
Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { _ in
    if compteur % 3 == 0 { vue.lire() }
    compteur += 1
    vue.avancer()
}
app.run()
