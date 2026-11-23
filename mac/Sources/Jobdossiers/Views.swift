import AppKit
import ServiceManagement
import SwiftUI

@main
struct JobdossiersApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model = AppModel()

    var body: some Scene {
        MenuBarExtra("Jobdossiers", systemImage: "briefcase") {
            MenuView().environmentObject(model)
        }
        .menuBarExtraStyle(.window)
        Settings {
            SettingsView().environmentObject(model)
        }
    }
}

struct MenuView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Jobdossiers").font(.headline)
                Text("v" + AppInfo.version).font(.caption).foregroundStyle(.secondary)
            }
            if !model.hasKey {
                Label("Nessuna chiave salvata", systemImage: "key.slash").foregroundStyle(.secondary)
            } else if let r = model.result {
                Text("\(r.applications) schede" + (r.unreadable > 0 ? ", \(r.unreadable) non leggibili" : ""))
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 3) {
                    ForEach(r.byStatus, id: \.status) { row in
                        GridRow {
                            Text(label(row.status)).foregroundStyle(.secondary)
                            Text("\(row.count)").monospacedDigit().gridColumnAlignment(.trailing)
                        }
                    }
                }
                Text("Quota: " + (r.quota ?? "non comunicata dal portale")).font(.caption).foregroundStyle(.secondary)
            }
            if let e = model.error {
                Label(e, systemImage: "exclamationmark.triangle").foregroundStyle(.red).font(.caption).fixedSize(horizontal: false, vertical: true)
            }
            if let t = model.lastCheck {
                Text("Controllo: " + t.formatted(date: .omitted, time: .shortened)).font(.caption).foregroundStyle(.tertiary)
            }
            if let v = model.updateVersion {
                Button(model.updating ? "Scarico l'aggiornamento…" : "Aggiornamento disponibile: v\(v) — Installa") { Task { await model.installUpdate() } }
                    .buttonStyle(.borderedProminent).disabled(model.updating)
            }
            Divider()
            HStack {
                Button(model.checking ? "Controllo…" : "Controlla ora") { Task { await model.check() } }
                    .disabled(model.checking || !model.hasKey)
                Spacer()
                Button("Impostazioni…") { SettingsWindow.show(openSettings) }
                Button("Esci") { NSApp.terminate(nil) }
            }
        }
        .padding(14)
        .frame(width: 300)
    }

    private func label(_ s: String) -> String { Server.statusLabels.first { $0.0 == s }?.1 ?? s }
}

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @State private var key = ""
    @State private var keyMessage: String?
    @State private var keyOK = false
    @State private var loginMessage: String?
    @State private var confirmDelete = false

    var body: some View {
        TabView {
            accountTab
            assistantsTab
            browserTab
            generalTab
        }
        .frame(width: 540, height: 440)
        .navigationTitle("Impostazioni Jobdossiers " + AppInfo.version)
        .onAppear {
            NSApp.activate(ignoringOtherApps: true)
            model.refreshLoginStatus()
            model.refreshClients()
            model.refreshBrowsers()
        }
        .confirmationDialog("Eliminare la chiave dal Portachiavi?", isPresented: $confirmDelete) {
            Button("Elimina", role: .destructive) {
                let e = model.deleteKey()
                keyOK = e == nil
                keyMessage = e ?? "Chiave eliminata. Per revocarla davvero usa anche il portale."
            }
        } message: {
            Text("Il server MCP smetterà di funzionare finché non ne salvi una nuova.")
        }
    }

    private var accountTab: some View {
        Form {
            Section("Chiave per automazioni") {
                LabeledContent("Stato", value: model.hasKey ? "Salvata nel Portachiavi" : "Non salvata")
                HStack {
                    Button(model.linking ? "In attesa del browser…" : "Collega a Jobdossiers") {
                        Task { let r = await model.link(); keyOK = r.ok; keyMessage = r.message }
                    }
                    .buttonStyle(.borderedProminent).disabled(model.linking)
                    Spacer()
                }
                Text("Si apre il browser: accedi a jobdossiers.ch e conferma. La chiave arriva cifrata a questa app, senza copiarla.")
                    .font(.caption).foregroundStyle(.secondary)
                Text("Oppure incollala a mano:").font(.caption)
                SecureField("jda1.…", text: $key)
                    .onSubmit(save)
                HStack {
                    Button("Salva", action: save).disabled(key.isEmpty)
                    Button("Elimina chiave", role: .destructive) { confirmDelete = true }.disabled(!model.hasKey)
                }
                if let m = keyMessage { Text(m).font(.caption).foregroundStyle(keyOK ? .green : .red) }
                Text("La crei su jobdossiers.ch in Account → Chiave per automazioni (piano Plus). Il valore non viene mai mostrato né riletto dall'app.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .tabItem { Label("Account", systemImage: "person.crop.circle") }
    }

    private var assistantsTab: some View {
        Form {
            Section("Client MCP") {
                if model.clientCommand == nil {
                    Text("Server non incluso nell'app: costruiscila con mac/build-app.sh.").font(.caption).foregroundStyle(.red)
                } else {
                    ForEach(Clients.all) { c in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(c.name)
                                Text(describe(model.clientStates[c.id])).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            clientButtons(c)
                        }
                    }
                    HStack {
                        VStack(alignment: .leading) {
                            Text("Claude Code")
                            Text("Si configura dal Terminale").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Copia comando") { model.copyClaudeCodeCommand() }
                    }
                    if let m = model.clientMessage { Text(m).font(.caption) }
                    Text("Se sposti l'app (per esempio in Applicazioni), premi Aggiorna: i client puntano al server dentro l'app.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .tabItem { Label("Assistenti", systemImage: "sparkles") }
    }

    private var browserTab: some View {
        Form {
            Section("Estensione per il browser") {
                ForEach(Browsers.all) { b in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(b.name)
                            Text(describe(model.extensionStates[b.id])).font(.caption).foregroundStyle(stateColor(model.extensionStates[b.id]))
                        }
                        Spacer()
                        browserButton(b)
                    }
                }
                if let m = model.browserMessage { Text(m).font(.caption) }
                Text("Salva in Jobdossiers l'annuncio che stai guardando, dal pannello laterale del browser. Finché non è negli store dei browser si installa in modalità sviluppatore: il pulsante prepara tutto e ti guida nei due passi da fare nel browser.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section {
                Button("Scollega i browser", role: .destructive) { model.unlinkBrowsers() }
            } footer: {
                Text("Toglie il collegamento tra i browser e questa app; l'estensione resta nel browser ma non potrà salvare.").font(.caption)
            }
        }
        .formStyle(.grouped)
        .tabItem { Label("Browser", systemImage: "globe") }
        .sheet(item: $model.guide) { g in BrowserGuide(target: g) }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in model.refreshBrowsers() }
    }

    @ViewBuilder private func browserButton(_ b: Browser) -> some View {
        switch model.extensionStates[b.id] {
        case .browserMissing?, nil: EmptyView()
        case .outdated?: Button("Aggiorna in \(short(b))…") { model.startInstall(b) }.buttonStyle(.borderedProminent)
        case .installed?: Button("Ripeti…") { model.startInstall(b) }
        default: Button("Installa in \(short(b))…") { model.startInstall(b) }.buttonStyle(.borderedProminent)
        }
    }

    private func short(_ b: Browser) -> String { b.name.replacingOccurrences(of: "Microsoft ", with: "").replacingOccurrences(of: "Google ", with: "") }

    private var generalTab: some View {
        Form {
            Section("Avvio") {
                Toggle("Apri all'accesso al Mac", isOn: Binding(get: { model.launchAtLogin }, set: { loginMessage = model.setLaunchAtLogin($0) }))
                if model.loginStatus == .requiresApproval {
                    HStack {
                        Text("Da approvare in Impostazioni di Sistema → Elementi login.").font(.caption)
                        Button("Apri") { SMAppService.openSystemSettingsLoginItems() }
                    }
                }
                if let m = loginMessage { Text(m).font(.caption).foregroundStyle(.red) }
            }
            Section("Informazioni e aggiornamenti") {
                LabeledContent("Versione", value: AppInfo.version)
                Toggle("Controlla gli aggiornamenti ogni giorno", isOn: $model.autoUpdate)
                HStack {
                    Button("Controlla ora") { Task { await model.checkAppUpdate(force: true) } }
                    if let v = model.updateVersion {
                        Button(model.updating ? "Scarico…" : "Installa la versione \(v)") { Task { await model.installUpdate() } }
                            .buttonStyle(.borderedProminent).disabled(model.updating)
                    }
                }
                if let m = model.updateMessage { Text(m).font(.caption).foregroundStyle(.secondary) }
                Text("Gli aggiornamenti arrivano dalla release pubblica su GitHub e si installano solo se la firma è valida. macOS chiede la password per sostituire l'app in Applicazioni; poi l'app si riapre da sola.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Server per il controllo") {
                LabeledContent("In uso", value: model.resolvedServer ?? "non trovato")
                HStack {
                    Button("Scegli…", action: choose)
                    Button("Predefinito") { model.serverPath = "" }.disabled(model.serverPath.isEmpty)
                }
                Text("Solo per sviluppo: cambia il server usato da \"Controlla ora\", non quello scritto nei client.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .tabItem { Label("Generale", systemImage: "gearshape") }
    }

    private func describe(_ s: ClientState?) -> String {
        switch s {
        case .notInstalled?, nil: return "Non installato"
        case .notConfigured?: return "Non configurato"
        case .configured?: return "Configurato"
        case .outdated?: return "Punta a un altro server: da aggiornare"
        case .unreadable(let m)?: return m
        }
    }

    private func describe(_ s: ExtensionState?) -> String {
        switch s {
        case .browserMissing?, nil: return "Non installato su questo Mac"
        case .notLinked?: return "Da installare"
        case .notLoaded?: return "Collegato: manca l'estensione nel browser"
        case .installed(let v)?: return "Installata, \(v)"
        case .outdated(let v)?: return "Da aggiornare: nel browser c'è la \(v), nell'app la \(Browsers.label(version: AppInfo.version, build: Browsers.bundledBuild))"
        }
    }

    private func stateColor(_ s: ExtensionState?) -> Color {
        switch s {
        case .installed?: return .green
        case .outdated?, .notLoaded?: return .orange
        default: return .secondary
        }
    }

    @ViewBuilder private func clientButtons(_ c: MCPClient) -> some View {
        switch model.clientStates[c.id] {
        case .notConfigured?: Button("Configura") { model.configure(c) }
        case .configured?: Button("Rimuovi") { model.unconfigure(c) }
        case .outdated?:
            Button("Aggiorna") { model.configure(c) }
            Button("Rimuovi") { model.unconfigure(c) }
        default: EmptyView()
        }
    }

    private func save() {
        let e = model.saveKey(key)
        keyOK = e == nil
        keyMessage = e ?? "Chiave salvata."
        if e == nil { key = "" }
    }

    private func choose() {
        let panel = NSOpenPanel()
        panel.message = "Scegli il binario jobdossiers-mcp (o src/index.js per lo sviluppo)"
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url { model.serverPath = url.path }
    }
}

/// L'app vive nella barra dei menu (LSUIElement): senza attivarla, la finestra delle Impostazioni già aperta resterebbe dietro le altre.
/// «Impostazioni…» la apre (o la ritrova) e la porta sempre in primo piano.
@MainActor
enum SettingsWindow {
    static func show(_ openSettings: OpenSettingsAction) {
        NSApp.activate(ignoringOtherApps: true)
        openSettings()
        // la finestra può nascere dopo openSettings(): la si porta davanti appena c'è
        DispatchQueue.main.async { front() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { front() }
    }

    private static func front() {
        for w in NSApp.windows where w.identifier?.rawValue == "com_apple_SwiftUI_Settings_window" || w.title.hasPrefix("Impostazioni Jobdossiers") {
            if w.isMiniaturized { w.deminiaturize(nil) }
            w.makeKeyAndOrderFront(nil)
            w.orderFrontRegardless()
        }
    }
}

/// Finestra guidata: i due gesti che il browser non lascia fare a un programma, con le parole di quel browser.
/// Si aggiorna da sola: quando l'estensione si presenta (azione hello) mostra «Fatto».
struct BrowserGuide: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let target: GuideTarget
    private let tick = Timer.publish(every: 2, on: .main, in: .common).autoconnect()

    private var b: Browser { target.browser }
    private var done: Bool { if case .installed? = model.extensionStates[b.id] { return true }; return false }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(target.update ? "Aggiornare l'estensione in \(b.name)" : "Installare l'estensione in \(b.name)").font(.title2.bold())
            Text("Ho già collegato \(b.name) a questa app, preparato la cartella e aperto la pagina delle estensioni.").foregroundStyle(.secondary)
            if target.update {
                step(1, "Nella pagina **Estensioni** di \(b.name), sotto **Jobdossiers**, premi **Ricarica** (la freccia circolare).")
                step(2, "Riapri il pannello Jobdossiers: in alto deve comparire **\(Browsers.label(version: AppInfo.version, build: Browsers.bundledBuild))**.")
            } else {
                step(1, "Nella pagina **Estensioni** attiva **Modalità sviluppatore** (\(b.devModeWhere)).")
                step(2, "Premi **\(b.loadButton)**. Nella finestra che si apre premi **⌘ ⇧ G**, poi **⌘ V** (il percorso è già copiato), **Invio** e **Seleziona**.")
                step(3, "Per avere l'icona sempre a portata: premi \(b.pinHow).")
                step(4, "Apri un annuncio e premi l'icona **JD**: si apre il pannello laterale.")
            }
            HStack {
                Text(Browsers.exportedPathForDialog).font(.caption.monospaced()).textSelection(.enabled).foregroundStyle(.secondary)
                Spacer()
                Button("Copia percorso") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(Browsers.exportedPathForDialog, forType: .string)
                }
                Button("Riapri la pagina") { Browsers.openExtensionsPage(b) }
            }
            Divider()
            HStack {
                if done {
                    Label("Fatto: l'estensione \(Browsers.label(version: AppInfo.version, build: Browsers.bundledBuild)) è attiva in \(b.name).", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                } else {
                    ProgressView().controlSize(.small)
                    Text("In attesa che l'estensione si presenti…").foregroundStyle(.secondary)
                }
                Spacer()
                Button(done ? "Fine" : "Chiudi") { dismiss() }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(22)
        .frame(width: 520)
        .onReceive(tick) { _ in model.refreshBrowsers() }
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(n)").font(.headline).frame(width: 22, height: 22).background(Circle().fill(Color.accentColor.opacity(0.18)))
            Text(.init(text)).fixedSize(horizontal: false, vertical: true)
        }
    }
}
