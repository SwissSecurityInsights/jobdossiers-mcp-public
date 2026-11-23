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

    /// Da aggiornare se cambia la versione o, a parità di versione (build locali), la data di costruzione.
    static func state(_ b: Browser, command: String, appVersion: String = AppInfo.version, appBuild: String = bundledBuild,
                      home: URL = URL(fileURLWithPath: NSHomeDirectory()), appInstalled: Bool? = nil) -> ExtensionState {
        guard appInstalled ?? Self.appInstalled(b) else { return .browserMissing }
        guard linkedPath(b, home: home) == command else { return .notLinked }
        guard let s = seen(b, home: home) else { return .notLoaded }
        let same = s.version == appVersion && (appBuild.isEmpty || s.build == appBuild)
        let l = label(version: s.version, build: s.build)
        return same ? .installed(l) : .outdated(l)
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

    static func exportExtension(from src: URL, to dst: URL) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: dst.deletingLastPathComponent(), withIntermediateDirectories: true)
        if fm.fileExists(atPath: dst.path) { try fm.removeItem(at: dst) }
        try fm.copyItem(at: src, to: dst)
    }
}
