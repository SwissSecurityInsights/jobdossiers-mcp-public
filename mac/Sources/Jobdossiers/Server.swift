/* Esegue `jobdossiers-mcp --check` (sola lettura: conteggi, mai valori) e ne legge il JSON. */
import Foundation

struct CheckResult {
    let applications: Int
    let unreadable: Int
    let byStatus: [(status: String, count: Int)]
    let quota: String?
}

enum Server {
    static let pathKey = "serverPath"

    /// Ordine e nomi come lo schema Status di openapi.json; hr_interview e tech_interview sono i nomi precedenti a interview (28.10.2026).
    static let statusLabels: [(String, String)] = [
        ("preparing", "In preparazione"), ("to_send", "Da inviare"), ("sent", "Inviate"),
        ("in_review", "In valutazione"), ("interview", "Colloquio"), ("hr_interview", "Colloquio HR"), ("tech_interview", "Colloquio tecnico"),
        ("offer", "Offerta"), ("rejected", "Rifiutate"), ("withdrawn", "Ritirate"),
        ("no_answer", "Nessuna risposta"), ("deleted", "Cancellate"),
    ]

    enum Failure: LocalizedError {
        case notFound, timeout, failed(String), badOutput
        var errorDescription: String? {
            switch self {
            case .notFound: return "Server jobdossiers-mcp non trovato: sceglilo nelle impostazioni."
            case .timeout: return "Il server non ha risposto entro 60 secondi."
            case .failed(let m): return m
            case .badOutput: return "Risposta del server non leggibile."
            }
        }
    }

    /// Il server compilato che build-app.sh mette dentro l'app.
    static var bundled: URL? { Bundle.main.url(forResource: "jobdossiers-mcp", withExtension: nil) }

    /// Cosa scrivere nei client MCP: il server dell'app; fuori dal pacchetto .app un binario trovato (mai un .js, che richiederebbe node nel PATH del client).
    static func clientCommand() -> String? {
        if let b = bundled { return b.path }
        if let r = resolve(), r.pathExtension != "js" { return r.path }
        return nil
    }

    /// Percorso scelto dall'utente (sviluppo), poi il binario dentro l'app, poi i percorsi d'installazione comuni.
    static func resolve() -> URL? {
        let fm = FileManager.default
        if let p = UserDefaults.standard.string(forKey: pathKey), !p.isEmpty { return fm.fileExists(atPath: p) ? URL(fileURLWithPath: p) : nil }
        if let b = bundled { return b }
        let home = NSHomeDirectory()
        return ["/opt/homebrew/bin/jobdossiers-mcp", "/usr/local/bin/jobdossiers-mcp", home + "/bin/jobdossiers-mcp", home + "/.local/bin/jobdossiers-mcp"]
            .first { fm.isExecutableFile(atPath: $0) }.map { URL(fileURLWithPath: $0) }
    }

    static func check() async throws -> CheckResult {
        guard let url = resolve() else { throw Failure.notFound }
        let data = try await run(url, ["--check"])
        guard let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any], j["ok"] as? Bool == true else { throw Failure.badOutput }
        let counts = j["by_status"] as? [String: Int] ?? [:]
        let known = Set(statusLabels.map(\.0))
        let ordered = statusLabels.compactMap { s, _ in counts[s].map { (s, $0) } }
            + counts.filter { !known.contains($0.key) }.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
        var quota: String?
        if let q = j["quota"], !(q is NSNull), let d = try? JSONSerialization.data(withJSONObject: q, options: [.sortedKeys, .fragmentsAllowed]) {
            quota = String(data: d, encoding: .utf8)
        }
        return CheckResult(applications: j["applications"] as? Int ?? 0, unreadable: j["unreadable"] as? Int ?? 0,
                           byStatus: ordered.map { (status: $0.0, count: $0.1) }, quota: quota)
    }

    /// Collega il Mac dal browser (`--login`, docs/collega-dispositivo.md): il server apre il browser, riceve la chiave cifrata per lui
    /// e la salva nel Portachiavi. Qui arriva solo l'esito (numero di schede), mai la chiave.
    static func link(deviceName: String) async throws -> Int {
        guard let url = resolve() else { throw Failure.notFound }
        let data = try await run(url, ["--login", "--name", deviceName], timeout: 6 * 60)
        guard let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any], j["ok"] as? Bool == true else { throw Failure.badOutput }
        return j["applications"] as? Int ?? 0
    }

    /// Un file .js (sviluppo) gira con node; le app avviate dal Finder hanno un PATH minimo, quindi lo allargo.
    private static func run(_ url: URL, _ args: [String], timeout: Double = 60) async throws -> Data {
        let p = Process()
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (env["PATH"] ?? "")
        p.environment = env
        if url.pathExtension == "js" {
            p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            p.arguments = ["node", url.path] + args
        } else {
            p.executableURL = url
            p.arguments = args
        }
        let out = Pipe(), err = Pipe()
        p.standardOutput = out
        p.standardError = err
        p.standardInput = FileHandle.nullDevice

        return try await withCheckedThrowingContinuation { cont in
            let once = Once()
            let finish: @Sendable (Result<Data, Error>) -> Void = { r in if once.claim() { cont.resume(with: r) } }
            p.terminationHandler = { proc in
                let o = out.fileHandleForReading.readDataToEndOfFile()
                let e = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                if proc.terminationStatus == 0 { finish(.success(o)) }
                else { finish(.failure(Failure.failed(e.replacingOccurrences(of: "Errore: ", with: "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(300).description))) }
            }
            do { try p.run() } catch { finish(.failure(Failure.failed(error.localizedDescription))); return }
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                if p.isRunning { p.terminate(); finish(.failure(Failure.timeout)) }
            }
        }
    }
}

/// Fine del processo e scadenza arrivano da code diverse: la continuation va ripresa una volta sola.
private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false

    func claim() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if done { return false }
        done = true
        return true
    }
}
