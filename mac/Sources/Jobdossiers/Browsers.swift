/* Estensione per Chrome ed Edge: il server dell'app si registra come host di native messaging (src/native.js).
 * Scrittura e rimozione le fa il server stesso (--browser-install / --browser-remove), così la regola è una sola per Mac e Windows.
 * Stato per browser: app del browser presente, collegamento (manifest dell'host) e «estensione vista»: un file che l'estensione fa
 * scrivere al server all'installazione e a ogni avvio del browser (azione hello), perché macOS non lascia leggere all'app i dati dei browser. */
import AppKit

struct Browser: Identifiable, Equatable {
    let id: String            // come SEEN_BROWSERS in src/native.js
    let name: String          // nome dell'app, anche per `open -a`
    let dir: String           // cartella del profilo, relativa alla home
    let extensionsURL: String
    let devModeWhere: String
    let loadButton: String
    let pinHow: String
}

enum ExtensionState: Equatable {
    case browserMissing, notLinked, notLoaded, installed(String), outdated(String)
}

enum Browsers {
    static let hostName = "ch.jobdossiers.mcp"
    static let all: [Browser] = [
        Browser(id: "edge", name: "Microsoft Edge", dir: "Library/Application Support/Microsoft Edge", extensionsURL: "edge://extensions/",
                devModeWhere: "in basso nella colonna a sinistra", loadButton: "Carica decompressa",
                pinHow: "l'icona Estensioni (il pezzo di puzzle) accanto alla barra degli indirizzi, poi l'occhio accanto a Jobdossiers"),
        Browser(id: "chrome", name: "Google Chrome", dir: "Library/Application Support/Google/Chrome", extensionsURL: "chrome://extensions/",
                devModeWhere: "in alto a destra", loadButton: "Carica estensione non pacchettizzata",
                pinHow: "l'icona Estensioni (il pezzo di puzzle) accanto alla barra degli indirizzi, poi la puntina accanto a Jobdossiers"),
    ]

    static func manifestURL(_ dir: String, home: URL) -> URL {
        home.appendingPathComponent(dir).appendingPathComponent("NativeMessagingHosts").appendingPathComponent("\(hostName).json")
    }

    static func appInstalled(_ b: Browser) -> Bool {
        ["/Applications", NSHomeDirectory() + "/Applications"].contains { FileManager.default.fileExists(atPath: "\($0)/\(b.name).app") }
    }

    /// Path scritto nel manifest dell'host per questo browser (nil se non collegato).
    static func linkedPath(_ b: Browser, home: URL) -> String? {
        guard let data = FileManager.default.contents(atPath: manifestURL(b.dir, home: home).path) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["path"] as? String ?? ""
    }

    /// Versione e data di costruzione dell'estensione vista l'ultima volta in questo browser (azione hello del server).
    static func seen(_ b: Browser, home: URL) -> (version: String, build: String)? {
        let f = home.appendingPathComponent("Library/Application Support/Jobdossiers/estensione-\(b.id).json")
        guard let data = FileManager.default.contents(atPath: f.path),
              let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let v = o["version"] as? String else { return nil }
        return (v, o["build"] as? String ?? "")
    }

    /// Data di costruzione dell'estensione dentro questa app (build.json, scritto da build-app.sh).
    static var bundledBuild: String {
        guard let f = extensionFolder?.appendingPathComponent("build.json"), let data = try? Data(contentsOf: f) else { return "" }
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["built_at"] as? String ?? ""
    }

    /// «v0.2.3 · 23.11 14:05» (ora locale), come nel pannello dell'estensione.
    static func label(version: String, build: String) -> String {
        guard let d = ISO8601DateFormatter().date(from: build) else { return "v\(version)" }
        let f = DateFormatter(); f.dateFormat = "dd.MM HH:mm"
        return "v\(version) · \(f.string(from: d))"
    }

    /// -1, 0, 1 tra (versione, data di costruzione): prima la versione «1.2.3», poi la data ISO (stesso formato, si confronta come testo).
    static func compare(_ a: (version: String, build: String), _ b: (version: String, build: String)) -> Int {
        let x = a.version.split(separator: ".").map { Int($0) ?? 0 }, y = b.version.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<3 { let d = (i < x.count ? x[i] : 0) - (i < y.count ? y[i] : 0); if d != 0 { return d > 0 ? 1 : -1 } }
        return a.build == b.build ? 0 : (a.build > b.build ? 1 : -1)
    }

    /// Da aggiornare solo se nel browser c'è un'estensione più vecchia di quella dell'app (versione, poi data di costruzione).
    /// Più nuova va bene: l'estensione si aggiorna anche online (src/update.js) e l'app non la riporta indietro.
    static func state(_ b: Browser, command: String, appVersion: String = AppInfo.version, appBuild: String = bundledBuild,
                      home: URL = URL(fileURLWithPath: NSHomeDirectory()), appInstalled: Bool? = nil) -> ExtensionState {
        guard appInstalled ?? Self.appInstalled(b) else { return .browserMissing }
        guard linkedPath(b, home: home) == command else { return .notLinked }
        guard let s = seen(b, home: home) else { return .notLoaded }
        let l = label(version: s.version, build: s.build)
        if appBuild.isEmpty { return compare((s.version, ""), (appVersion, "")) >= 0 ? .installed(l) : .outdated(l) }
        return compare(s, (appVersion, appBuild)) >= 0 ? .installed(l) : .outdated(l)
    }

    /// Esegue il server con --browser-install o --browser-remove. Nessun segreto passa di qui.
    static func run(_ command: String, _ arg: String) throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: command)
        p.arguments = [arg]
        let err = Pipe()
        p.standardOutput = FileHandle.nullDevice
        p.standardError = err
        try p.run()
        p.waitUntilExit()
        guard p.terminationStatus == 0 else {
            let m = String(decoding: err.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            throw Server.Failure.failed(m.isEmpty ? "Registrazione per il browser non riuscita" : String(m.prefix(300)))
        }
    }

    /// Apre la pagina delle estensioni nel browser indicato, non in quello predefinito.
    static func openExtensionsPage(_ b: Browser) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        p.arguments = ["-a", b.name, b.extensionsURL]
        try? p.run()
    }

    /// Cartella dell'estensione dentro l'app (build-app.sh).
    static var extensionFolder: URL? { Bundle.main.url(forResource: "estensione", withExtension: nil) }

    /// Il browser non sceglie cartelle dentro un pacchetto .app: l'estensione si copia in una cartella normale, da caricare come
    /// estensione non pacchettizzata. A ogni copia si sostituisce (nuova versione dell'app): nel browser poi basta «Ricarica».
    static func exportedFolder(home: URL = URL(fileURLWithPath: NSHomeDirectory())) -> URL {
        home.appendingPathComponent("Library/Application Support/Jobdossiers/estensione")
    }

    /// Da incollare nella finestra di scelta del browser (⌘⇧G): con «~» si raggiunge la Libreria, che il Finder nasconde.
    static let exportedPathForDialog = "~/Library/Application Support/Jobdossiers/estensione"

    /// Versione e data di costruzione di una cartella dell'estensione (manifest.json e build.json).
    static func folderBuild(_ dir: URL) -> (version: String, build: String)? {
        guard let m = try? Data(contentsOf: dir.appendingPathComponent("manifest.json")),
              let v = (try? JSONSerialization.jsonObject(with: m) as? [String: Any])?["version"] as? String else { return nil }
        let b = (try? Data(contentsOf: dir.appendingPathComponent("build.json"))).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["built_at"] as? String ?? ""
        return (v, b)
    }

    /// Copia l'estensione dell'app nella cartella caricata dal browser, ma non sopra una più nuova arrivata con l'aggiornamento online.
    static func exportExtension(from src: URL, to dst: URL) throws {
        let fm = FileManager.default
        if let have = folderBuild(dst), let mine = folderBuild(src), compare(have, mine) > 0 { return }
        try fm.createDirectory(at: dst.deletingLastPathComponent(), withIntermediateDirectories: true)
        if fm.fileExists(atPath: dst.path) { try fm.removeItem(at: dst) }
        try fm.copyItem(at: src, to: dst)
    }
}
