/* La chiave jda1.… nel Portachiavi, nella stessa voce che legge il server
 * (`security find-generic-password -s jobdossiers-mcp -a <utente>` in src/store.js).
 * L'app scrive e cancella la chiave ma non ne legge mai il valore.
 *
 * Scrittura e cancellazione passano da /usr/bin/security, come `jobdossiers-mcp --set-key`:
 * una voce creata dall'app con SecItemAdd appartiene alla partizione dell'app (firma ad hoc),
 * e macOS chiede il permesso, o rifiuta, quando poi il server la legge con /usr/bin/security.
 * La chiave arriva a `security -i` sullo standard input, mai sulla riga di comando. */
import Foundation
import Security

enum KeyStore {
    static let service = "jobdossiers-mcp"
    static let tool = "/usr/bin/security"
    static var account: String { NSUserName() }

    enum Failure: LocalizedError {
        case format
        case keychain(OSStatus)
        case tool(String)

        var errorDescription: String? {
            switch self {
            case .format: return "La chiave deve avere la forma jda1.<token>.<segreto>, con token e segreto di 43 caratteri."
            case .keychain(let s): return "Portachiavi: " + ((SecCopyErrorMessageString(s, nil) as String?) ?? "errore \(s)")
            case .tool(let m): return "Portachiavi: " + m
            }
        }
    }

    /// Stessa regola di parseKey in src/crypto.js.
    static func isValid(_ key: String) -> Bool {
        let p = key.split(separator: ".", omittingEmptySubsequences: false)
        guard p.count == 3, p[0] == "jda1" else { return false }
        let b64u = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")
        return p[1...].allSatisfy { $0.count == 43 && $0.unicodeScalars.allSatisfy(b64u.contains) }
    }

    /// Solo la presenza: chiedere gli attributi non apre la richiesta di accesso del Portachiavi.
    static func exists() -> Bool {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: account, kSecReturnAttributes as String: true]
        return SecItemCopyMatching(q as CFDictionary, nil) == errSecSuccess
    }

    static func save(_ raw: String) throws {
        let key = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isValid(key) else { throw Failure.format }
        // Via la voce vecchia (anche quella creata dalle versioni precedenti dell'app): -U non ne cambierebbe l'accesso.
        try delete()
        try run(addCommand(key: key))
        guard exists() else { throw Failure.tool("la chiave non risulta salvata") }
    }

    static func delete() throws {
        guard exists() else { return }
        try run(deleteCommand())
        guard !exists() else { throw Failure.tool("la chiave non è stata cancellata") }
    }

    /// Comandi per `security -i`. Account e chiave sono già controllati (nome utente macOS, base64url), ma vanno comunque tra virgolette.
    static func addCommand(key: String) -> String {
        "add-generic-password -s \(quote(service)) -a \(quote(account)) -l \(quote(service)) -w \(quote(key))\n"
    }

    static func deleteCommand() -> String {
        "delete-generic-password -s \(quote(service)) -a \(quote(account))\n"
    }

    static func quote(_ s: String) -> String {
        "\"" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
    }

    /// Esegue un comando di `security -i` passato sullo standard input. Nei messaggi d'errore non finisce mai il comando.
    private static func run(_ command: String) throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: tool)
        p.arguments = ["-i"]
        let input = Pipe(), output = Pipe()
        p.standardInput = input
        p.standardOutput = output
        p.standardError = output
        try p.run()
        input.fileHandleForWriting.write(Data(command.utf8))
        try? input.fileHandleForWriting.close()
        let out = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        p.waitUntilExit()
        guard p.terminationStatus == 0 else {
            // Solo la riga con il codice d'errore (es. "returned -25300"): il resto dell'output non serve e non si mostra.
            let code = out.split(separator: "\n").last { $0.contains("returned") }.map(String.init) ?? "uscita \(p.terminationStatus)"
            throw Failure.tool("security non è riuscito (\(code))")
        }
    }
}
