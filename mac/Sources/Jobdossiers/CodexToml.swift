/* Configurazione di ChatGPT Desktop e Codex: ~/.codex/config.toml (o $CODEX_HOME/config.toml), un server per sezione [mcp_servers.<nome>]
 * con command ed eventuali sottosezioni ([mcp_servers.<nome>.env]). Su macOS ChatGPT salva così il server aggiunto da Settings → MCP servers
 * (command tra doppi apici, enabled = true) e Codex lo usa; la Chat di ChatGPT su macOS non espone i server locali (prova dell'11.11.2026).
 * Si lavora riga per riga e si toccano solo le sezioni del nostro server: il resto del file resta com'è. Stessa logica di win/…/CodexToml.cs. */
import Foundation

enum CodexToml {
    static let name = "jobdossiers"

    private struct Block { let server: String; let sub: Bool; let start: Int; let end: Int }

    /// Nome della tabella di un'intestazione [..], nil se la riga non è un'intestazione di tabella.
    private static func header(_ line: String) -> String? {
        let t = line.trimmingCharacters(in: .whitespaces)
        guard t.hasPrefix("["), !t.hasPrefix("[["), let close = t.lastIndex(of: "]"), close > t.index(after: t.startIndex) else { return nil }
        return String(t[t.index(after: t.startIndex)..<close]).trimmingCharacters(in: .whitespaces)
    }

    /// Divide un nome di tabella sui punti fuori dalle virgolette e toglie le virgolette.
    private static func keys(_ table: String) -> [String] {
        var keys: [String] = [], cur = "", quote: Character? = nil
        for ch in table {
            if let q = quote { if ch == q { quote = nil } else { cur.append(ch) } }
            else if ch == "\"" || ch == "'" { quote = ch }
            else if ch == "." { keys.append(cur.trimmingCharacters(in: .whitespaces)); cur = "" }
            else { cur.append(ch) }
        }
        keys.append(cur.trimmingCharacters(in: .whitespaces))
        return keys
    }

    private static func blocks(_ lines: [String]) -> [Block] {
        let heads = lines.indices.compactMap { i in header(lines[i]).map { (i, $0) } }
        return heads.indices.compactMap { k in
            let ks = keys(heads[k].1)
            guard ks.count >= 2, ks[0] == "mcp_servers" else { return nil }
            return Block(server: ks[1], sub: ks.count > 2, start: heads[k].0, end: k + 1 < heads.count ? heads[k + 1].0 : lines.count)
        }
    }

    /// Valore di una riga «chiave = 'x'» o «chiave = "x"», nil se la riga è un'altra.
    private static func value(_ line: String, _ key: String) -> String? {
        let t = line.trimmingCharacters(in: .whitespaces)
        guard t.hasPrefix(key) else { return nil }
        var rest = t.dropFirst(key.count).trimmingCharacters(in: .whitespaces)
        guard rest.hasPrefix("=") else { return nil }
        rest = rest.dropFirst().trimmingCharacters(in: .whitespaces)
        guard let q = rest.first, q == "'" || q == "\"" else { return nil }
        var out = "", escape = false
        for ch in rest.dropFirst() {
            if q == "\"" && escape { out.append(ch == "n" ? "\n" : ch == "t" ? "\t" : ch); escape = false; continue }
            if q == "\"" && ch == "\\" { escape = true; continue }
            if ch == q { return out }
            out.append(ch)
        }
        return nil
    }

    private static func command(_ lines: [String], _ b: Block) -> String? {
        lines[(b.start + 1)..<b.end].lazy.compactMap { value($0, "command") }.first
    }

    /// Stringa TOML per un percorso: tra doppi apici come la scrive ChatGPT su macOS, con escape di \ e ".
    static func quote(_ s: String) -> String { "\"" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\"" }

    private static func lines(_ text: String?) -> [String] { (text ?? "").replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n") }

    /// Nomi dei server che puntano a questo eseguibile.
    static func servers(for command: String, in text: String?) -> [String] {
        let ls = lines(text)
        return blocks(ls).filter { !$0.sub && Self.command(ls, $0) == command }.map(\.server)
    }

    static func state(_ text: String?, command: String) -> ClientState {
        if !servers(for: command, in: text).isEmpty { return .configured }
        return blocks(lines(text)).contains { !$0.sub && $0.server == name } ? .outdated : .notConfigured
    }

    /// Aggiunge [mcp_servers.jobdossiers] (o ne aggiorna command); se un server punta già qui, non cambia nulla.
    static func merged(_ text: String?, command: String) -> String {
        if !servers(for: command, in: text).isEmpty { return text ?? "" }
        var ls = lines(text)
        let cmdLine = "command = " + quote(command)
        if let own = blocks(ls).first(where: { !$0.sub && $0.server == name }) {
            if let at = ((own.start + 1)..<own.end).first(where: { value(ls[$0], "command") != nil }) { ls[at] = cmdLine } else { ls.insert(cmdLine, at: own.start + 1) }
            return ls.joined(separator: "\n")
        }
        while let last = ls.last, last.trimmingCharacters(in: .whitespaces).isEmpty { ls.removeLast() }
        if !ls.isEmpty { ls.append("") }
        ls += ["[mcp_servers.\(name)]", cmdLine, "args = []", ""]
        return ls.joined(separator: "\n")
    }

    /// Toglie i server che puntano a questo eseguibile e [mcp_servers.jobdossiers], con le loro sottosezioni.
    static func removed(_ text: String, command: String) -> String {
        let names = Set(servers(for: command, in: text) + [name])
        let ls = lines(text)
        var drop = Set<Int>()
        for b in blocks(ls) where names.contains(b.server) { drop.formUnion(b.start..<b.end) }
        return ls.indices.filter { !drop.contains($0) }.map { ls[$0] }.joined(separator: "\n")
    }
}
