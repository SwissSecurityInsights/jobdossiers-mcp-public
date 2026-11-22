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

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Jobdossiers").font(.headline)
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
            Divider()
            HStack {
                Button(model.checking ? "Controllo…" : "Controlla ora") { Task { await model.check() } }
                    .disabled(model.checking || !model.hasKey)
                Spacer()
                SettingsLink { Text("Impostazioni…") }
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
        Form {
            Section("Chiave per automazioni") {
                LabeledContent("Stato", value: model.hasKey ? "Salvata nel Portachiavi" : "Non salvata")
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
            Section("Estensione per Chrome ed Edge") {
                HStack {
                    VStack(alignment: .leading) {
                        Text("Salva gli annunci dal browser")
                        Text(describeBrowsers(model.browserState)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    switch model.browserState {
                    case .notConfigured: Button("Configura") { model.configureBrowsers(true) }
                    case .configured: Button("Rimuovi") { model.configureBrowsers(false) }
                    case .outdated:
                        Button("Aggiorna") { model.configureBrowsers(true) }
                        Button("Rimuovi") { model.configureBrowsers(false) }
                    default: EmptyView()
                    }
                }
                if let dir = Browsers.extensionFolder {
                    HStack {
                        Text("Prototipo: nel browser apri Estensioni, attiva la modalità sviluppatore e carica questa cartella.")
                            .font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("Mostra cartella") { NSWorkspace.shared.activateFileViewerSelecting([dir]) }
                    }
                }
                if let m = model.browserMessage { Text(m).font(.caption) }
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
        .frame(width: 520)
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

    private func describe(_ s: ClientState?) -> String {
        switch s {
        case .notInstalled?, nil: return "Non installato"
        case .notConfigured?: return "Non configurato"
        case .configured?: return "Configurato"
        case .outdated?: return "Punta a un altro server: da aggiornare"
        case .unreadable(let m)?: return m
        }
    }

    private func describeBrowsers(_ s: ClientState) -> String {
        switch s {
        case .notInstalled: return "Né Chrome né Edge trovati (avviali almeno una volta)"
        case .notConfigured: return "Non collegato"
        case .configured: return "Collegato: " + Browsers.present().joined(separator: ", ")
        case .outdated: return "Punta a un altro server: da aggiornare"
        case .unreadable(let m): return m
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
