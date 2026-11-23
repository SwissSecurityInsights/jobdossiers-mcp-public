/* Stato dell'app: chiave presente, avvio all'accesso, ultimo controllo. Controlla all'avvio e poi ogni ora. */
import AppKit
import ServiceManagement

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var hasKey = KeyStore.exists()
    @Published private(set) var loginStatus = SMAppService.mainApp.status
    @Published private(set) var result: CheckResult?
    @Published private(set) var error: String?
    @Published private(set) var checking = false
    @Published private(set) var lastCheck: Date?
    @Published var serverPath = UserDefaults.standard.string(forKey: Server.pathKey) ?? "" {
        didSet { UserDefaults.standard.set(serverPath, forKey: Server.pathKey) }
    }

    private var timer: Timer?

    init() {
        timer = Timer.scheduledTimer(withTimeInterval: 3600, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.check() }
        }
        Task { await check() }
    }

    var resolvedServer: String? { Server.resolve()?.path }

    func check() async {
        hasKey = KeyStore.exists()
        guard hasKey, !checking else { return }
        checking = true
        defer { checking = false }
        do {
            result = try await Server.check()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        lastCheck = Date()
    }

    @Published private(set) var linking = false

    /// Collega il Mac dal browser (login e consenso su jobdossiers.ch): ritorna l'esito da mostrare e se è andata bene.
    func link() async -> (ok: Bool, message: String) {
        linking = true
        defer { linking = false }
        do {
            let n = try await Server.link(deviceName: Host.current().localizedName ?? "Mac")
            hasKey = KeyStore.exists()
            Task { await check() }
            return (true, "Collegato: \(n) candidature. La chiave è nel Portachiavi.")
        } catch {
            return (false, error.localizedDescription)
        }
    }

    /// Ritorna un messaggio d'errore, nil se è andata bene.
    func saveKey(_ key: String) -> String? {
        do { try KeyStore.save(key) } catch { return error.localizedDescription }
        hasKey = true
        Task { await check() }
        return nil
    }

    func deleteKey() -> String? {
        do { try KeyStore.delete() } catch { return error.localizedDescription }
        hasKey = false
        result = nil
        error = nil
        return nil
    }

    var launchAtLogin: Bool { loginStatus == .enabled || loginStatus == .requiresApproval }

    func setLaunchAtLogin(_ on: Bool) -> String? {
        defer { loginStatus = SMAppService.mainApp.status }
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    func refreshLoginStatus() { loginStatus = SMAppService.mainApp.status }

    // MARK: client MCP

    @Published private(set) var clientStates: [String: ClientState] = [:]
    @Published private(set) var clientMessage: String?

    var clientCommand: String? { Server.clientCommand() }

    func refreshClients() {
        guard let cmd = clientCommand else { clientStates = [:]; return }
        clientStates = Dictionary(uniqueKeysWithValues: Clients.all.map { ($0.id, Clients.state($0, command: cmd)) })
    }

    func configure(_ c: MCPClient) {
        guard let cmd = clientCommand else { return }
        do {
            try Clients.install(c, command: cmd)
            clientMessage = "\(c.name) configurato: riavvialo per caricare il server."
        } catch {
            clientMessage = "\(c.name): \(error.localizedDescription)"
        }
        refreshClients()
    }

    func unconfigure(_ c: MCPClient) {
        do {
            guard let cmd = clientCommand else { return }
            try Clients.remove(c, command: cmd)
            clientMessage = "Server tolto da \(c.name): riavvialo."
        } catch {
            clientMessage = "\(c.name): \(error.localizedDescription)"
        }
        refreshClients()
    }

    // MARK: estensione per Chrome ed Edge

    @Published private(set) var extensionStates: [String: ExtensionState] = [:]
    @Published private(set) var browserMessage: String?
    /// Finestra guidata aperta per un browser (installazione o aggiornamento).
    @Published var guide: GuideTarget?

    func refreshBrowsers() {
        guard let cmd = clientCommand else { extensionStates = [:]; return }
        extensionStates = Dictionary(uniqueKeysWithValues: Browsers.all.map { ($0.id, Browsers.state($0, command: cmd)) })
    }

    /// Tutto quello che si può fare da qui, poi la guida per i due gesti nel browser:
    /// collega il browser, copia l'estensione in una cartella normale, mette il percorso negli appunti,
    /// apre la pagina delle estensioni di QUEL browser e la cartella nel Finder.
    func startInstall(_ b: Browser) {
        guard let cmd = clientCommand, let src = Browsers.extensionFolder else { browserMessage = "Server o estensione non inclusi nell'app."; return }
        let update: Bool
        if case .outdated = extensionStates[b.id] { update = true } else { update = false }
        do {
            try Browsers.run(cmd, "--browser-install")
            try Browsers.exportExtension(from: src, to: Browsers.exportedFolder())
        } catch {
            browserMessage = error.localizedDescription
            return
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(Browsers.exportedPathForDialog, forType: .string)
        Browsers.openExtensionsPage(b)
        if !update { NSWorkspace.shared.activateFileViewerSelecting([Browsers.exportedFolder()]) }
        browserMessage = nil
        guide = GuideTarget(browser: b, update: update)
        refreshBrowsers()
    }

    func unlinkBrowsers() {
        guard let cmd = clientCommand else { return }
        do { try Browsers.run(cmd, "--browser-remove"); browserMessage = "Collegamento con i browser tolto: l'estensione non potrà più salvare." }
        catch { browserMessage = error.localizedDescription }
        refreshBrowsers()
    }

    func copyClaudeCodeCommand() {
        guard let cmd = clientCommand else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(Clients.claudeCodeCommand(cmd), forType: .string)
        clientMessage = "Comando per Claude Code copiato: incollalo nel Terminale."
    }
}

struct GuideTarget: Identifiable {
    let browser: Browser
    let update: Bool
    var id: String { browser.id }
}
