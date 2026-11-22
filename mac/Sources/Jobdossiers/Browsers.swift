/* Estensione per Chrome ed Edge: il server dell'app si registra come host di native messaging (src/native.js).
 * Scrittura e rimozione le fa il server stesso (--browser-install / --browser-remove), così la regola è una sola per Mac e Windows;
 * qui si leggono solo i manifest per mostrare lo stato. */
import Foundation

enum Browsers {
    static let hostName = "ch.jobdossiers.mcp"
    /// Cartelle dei profili, relative alla home: se mancano il browser non è installato (o non è mai stato avviato).
    static let all: [(name: String, dir: String)] = [
        ("Google Chrome", "Library/Application Support/Google/Chrome"),
        ("Microsoft Edge", "Library/Application Support/Microsoft Edge"),
    ]

    static func manifestURL(_ dir: String, home: URL) -> URL {
        home.appendingPathComponent(dir).appendingPathComponent("NativeMessagingHosts").appendingPathComponent("\(hostName).json")
    }

    /// Stato complessivo per i browser presenti: configurato se tutti puntano a command, da aggiornare se uno punta altrove.
    static func state(command: String, home: URL = URL(fileURLWithPath: NSHomeDirectory())) -> ClientState {
        let fm = FileManager.default
        let present = all.filter { fm.fileExists(atPath: home.appendingPathComponent($0.dir).path) }
        if present.isEmpty { return .notInstalled }
        var paths: [String?] = []
        for b in present {
            guard let data = fm.contents(atPath: manifestURL(b.dir, home: home).path) else { paths.append(nil); continue }
            let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            paths.append(o?["path"] as? String ?? "")
        }
        if paths.allSatisfy({ $0 == nil }) { return .notConfigured }
        if paths.contains(where: { $0 != nil && $0 != command }) { return .outdated }
        return paths.contains(where: { $0 == nil }) ? .notConfigured : .configured
    }

    /// Nomi dei browser presenti, per i messaggi.
    static func present(home: URL = URL(fileURLWithPath: NSHomeDirectory())) -> [String] {
        all.filter { FileManager.default.fileExists(atPath: home.appendingPathComponent($0.dir).path) }.map(\.name)
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

    /// Cartella dell'estensione dentro l'app (build-app.sh), da caricare nel browser come estensione non pacchettizzata.
    static var extensionFolder: URL? { Bundle.main.url(forResource: "estensione", withExtension: nil) }
}
