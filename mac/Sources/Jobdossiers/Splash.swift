/* Finestra di benvenuto all'avvio: l'app non ha Dock né finestra principale, quindi spiega dove trovarla. Sparisce dopo qualche secondo o al clic. */
import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var splash: NSPanel?

    func applicationDidFinishLaunching(_ notification: Notification) {
        showSplash(for: 3.5)
    }

    private func showSplash(for seconds: Double) {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 380, height: 260), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.level = .floating
        panel.hasShadow = true
        panel.isMovableByWindowBackground = true
        panel.contentView = NSHostingView(rootView: SplashView(hasKey: KeyStore.exists(), close: { [weak self] in self?.closeSplash() }))
        panel.center()
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { $0.duration = 0.25; panel.animator().alphaValue = 1 }
        splash = panel
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in self?.closeSplash() }
    }

    private func closeSplash() {
        guard let panel = splash else { return }
        splash = nil
        NSAnimationContext.runAnimationGroup({ $0.duration = 0.4; panel.animator().alphaValue = 0 }, completionHandler: { panel.orderOut(nil) })
    }
}

struct SplashView: View {
    let hasKey: Bool
    let close: () -> Void
    private var version: String { AppInfo.version }

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "briefcase.fill")
                .font(.system(size: 52))
                .foregroundStyle(.tint)
            VStack(spacing: 4) {
                Text("Jobdossiers").font(.title.bold())
                Text("Server MCP per le tue candidature · \(version)").font(.callout).foregroundStyle(.secondary)
            }
            Label("Trovi l'app nella barra dei menu, in alto a destra", systemImage: "arrow.up.right")
                .font(.callout)
            Text(hasKey ? "Chiave presente: il server è pronto per i client MCP." : "Nessuna chiave salvata: aprila da Impostazioni nel menu.")
                .font(.caption)
                .foregroundStyle(hasKey ? Color.secondary : Color.orange)
        }
        .multilineTextAlignment(.center)
        .padding(28)
        .frame(width: 380, height: 260)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
        .contentShape(Rectangle())
        .onTapGesture(perform: close)
    }
}
