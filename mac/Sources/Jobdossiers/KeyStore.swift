/* La chiave jda1.… nel Portachiavi, nella stessa voce che legge il server
 * (`security find-generic-password -s jobdossiers-mcp -a <utente>` in src/store.js).
 * L'app scrive e cancella la chiave ma non ne legge mai il valore. */
import Foundation
import Security

enum KeyStore {
    static let service = "jobdossiers-mcp"
    static var account: String { NSUserName() }

    enum Failure: LocalizedError {
        case format
        case keychain(OSStatus)

        var errorDescription: String? {
            switch self {
            case .format: return "La chiave deve avere la forma jda1.<token>.<segreto>, con token e segreto di 43 caratteri."
            case .keychain(let s): return "Portachiavi: " + ((SecCopyErrorMessageString(s, nil) as String?) ?? "errore \(s)")
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

    private static var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    /// Solo la presenza: chiedere gli attributi non apre la richiesta di accesso del Portachiavi.
    static func exists() -> Bool {
        var q = baseQuery
        q[kSecReturnAttributes as String] = true
        return SecItemCopyMatching(q as CFDictionary, nil) == errSecSuccess
    }

    static func save(_ raw: String) throws {
        let key = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isValid(key) else { throw Failure.format }
        try delete()
        var q = baseQuery
        q[kSecValueData as String] = Data(key.utf8)
        q[kSecAttrLabel as String] = service
        q[kSecAttrAccess as String] = try access()
        let s = SecItemAdd(q as CFDictionary, nil)
        guard s == errSecSuccess else { throw Failure.keychain(s) }
    }

    static func delete() throws {
        let s = SecItemDelete(baseQuery as CFDictionary)
        guard s == errSecSuccess || s == errSecItemNotFound else { throw Failure.keychain(s) }
    }

    /// Il server legge la chiave con /usr/bin/security: senza questa voce nell'ACL il Mac chiederebbe il permesso ogni volta che Claude lo avvia.
    private static func access() throws -> SecAccess {
        var me: SecTrustedApplication?, tool: SecTrustedApplication?, acc: SecAccess?
        var s = SecTrustedApplicationCreateFromPath(nil, &me)
        if s == errSecSuccess { s = SecTrustedApplicationCreateFromPath("/usr/bin/security", &tool) }
        if s == errSecSuccess, let me, let tool { s = SecAccessCreate(service as CFString, [me, tool] as CFArray, &acc) }
        guard s == errSecSuccess, let acc else { throw Failure.keychain(s) }
        return acc
    }
}
