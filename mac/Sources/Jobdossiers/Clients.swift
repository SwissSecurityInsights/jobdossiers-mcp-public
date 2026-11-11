/* Registra il server incluso nell'app nei client MCP che usano un file di configurazione JSON.
 * Tocca solo la voce "jobdossiers": le altre chiavi e gli altri server restano come sono. Prima di scrivere fa una copia .jobdossiers.bak. */
import Foundation

struct MCPClient: Identifiable {
    let id: String
    let name: String
    /// File di configurazione, relativo alla home.
    let config: String
    /// Cartella che indica che il client è installato, relativa alla home.
    let detect: String
    /// "mcpServers" quasi ovunque, "servers" in VS Code.
    var serversKey = "mcpServers"
    /// Campi fissi della voce (VS Code vuole il tipo di trasporto).
    var extra: [String: String] = [:]
    /// Configurazione di ChatGPT e Codex in TOML (vedi CodexToml).
    var toml = false
}

enum ClientState: Equatable {
    case notInstalled, notConfigured, configured, outdated, unreadable(String)
}

enum Clients {
    static let serverName = "jobdossiers"

    /// Solo i client più diffusi (decisione dell'11.11.2026); il server funziona con qualunque client MCP, gli altri si collegano a mano (README).
    /// ChatGPT su macOS usa i server locali solo in Codex, non nella Chat (prova dell'11.11.2026): da qui il nome della riga.
    static let all: [MCPClient] = [
        MCPClient(id: "claude", name: "Claude Desktop", config: "Library/Application Support/Claude/claude_desktop_config.json", detect: "Library/Application Support/Claude"),
        MCPClient(id: "chatgpt", name: "ChatGPT (Codex)", config: ".codex/config.toml", detect: ".codex", toml: true),
    ]

    enum Failure: LocalizedError {
        case unreadable
        var errorDescription: String? { "File di configurazione non leggibile (JSON non valido o con commenti): modificalo a mano." }
    }

    /// Claude Code tiene la configurazione in un file che riscrive mentre gira: meglio il suo comando.
    static func claudeCodeCommand(_ command: String) -> String {
        "claude mcp add --scope user \(serverName) -- '\(command.replacingOccurrences(of: "'", with: "'\\''"))'"
    }

    // MARK: file

    private static func url(_ rel: String) -> URL { URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(rel) }

    /// File di configurazione del client; per ChatGPT e Codex $CODEX_HOME, se impostata, lo sposta.
    static func configURL(_ c: MCPClient) -> URL {
        if c.toml, let home = ProcessInfo.processInfo.environment["CODEX_HOME"], !home.isEmpty { return URL(fileURLWithPath: home).appendingPathComponent("config.toml") }
        return url(c.config)
    }

    private static func installed(_ c: MCPClient) -> Bool {
        FileManager.default.fileExists(atPath: url(c.detect).path) || (c.toml && FileManager.default.fileExists(atPath: configURL(c).deletingLastPathComponent().path))
    }

    static func state(_ c: MCPClient, command: String) -> ClientState {
        let fm = FileManager.default
        guard installed(c) else { return .notInstalled }
        guard let data = fm.contents(atPath: configURL(c).path) else { return .notConfigured }
        if c.toml { return CodexToml.state(String(decoding: data, as: UTF8.self), command: command) }
        do {
            switch try configuredCommand(data, client: c) {
            case nil: return .notConfigured
            case command?: return .configured
            default: return .outdated
            }
        } catch {
            return .unreadable(error.localizedDescription)
        }
    }

    static func install(_ c: MCPClient, command: String) throws {
        let file = configURL(c)
        let data = FileManager.default.contents(atPath: file.path)
        if c.toml { return try write(Data(CodexToml.merged(data.map { String(decoding: $0, as: UTF8.self) }, command: command).utf8), to: file) }
        try write(merged(data, client: c, command: command), to: file)
    }

    /// command: l'eseguibile del server, per riconoscerne le voci anche con un altro nome (ChatGPT lascia scegliere il nome).
    static func remove(_ c: MCPClient, command: String) throws {
        let file = configURL(c)
        guard let data = FileManager.default.contents(atPath: file.path) else { return }
        if c.toml { return try write(Data(CodexToml.removed(String(decoding: data, as: UTF8.self), command: command).utf8), to: file) }
        try write(removed(data, client: c), to: file)
    }

    private static func write(_ data: Data, to file: URL) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        if fm.fileExists(atPath: file.path) {
            let bak = file.appendingPathExtension("jobdossiers.bak")
            try? fm.removeItem(at: bak)
            try fm.copyItem(at: file, to: bak)
        }
        try data.write(to: file, options: .atomic)
    }

    // MARK: JSON (funzioni pure, testate)

    private static func object(_ data: Data?) throws -> [String: Any] {
        guard let data, !data.allSatisfy({ [0x20, 0x0A, 0x0D, 0x09].contains($0) }) else { return [:] }
        guard let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Failure.unreadable }
        return o
    }

    private static func encode(_ o: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: o, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]) + Data("\n".utf8)
    }

    static func entry(_ c: MCPClient, command: String) -> [String: Any] {
        var e: [String: Any] = c.extra
        e["command"] = command
        e["args"] = [String]()
        return e
    }

    static func configuredCommand(_ data: Data, client c: MCPClient) throws -> String? {
        let servers = try object(data)[c.serversKey] as? [String: Any]
        return (servers?[serverName] as? [String: Any])?["command"] as? String
    }

    static func merged(_ data: Data?, client c: MCPClient, command: String) throws -> Data {
        var o = try object(data)
        var servers = o[c.serversKey] as? [String: Any] ?? [:]
        servers[serverName] = entry(c, command: command)
        o[c.serversKey] = servers
        return try encode(o)
    }

    static func removed(_ data: Data, client c: MCPClient) throws -> Data {
        var o = try object(data)
        guard var servers = o[c.serversKey] as? [String: Any] else { return data }
        servers[serverName] = nil
        o[c.serversKey] = servers
        return try encode(o)
    }
}
