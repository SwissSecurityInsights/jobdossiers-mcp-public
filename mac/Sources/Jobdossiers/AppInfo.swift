/* Versione dell'app (CFBundleShortVersionString, da package.json in build-app.sh), mostrata in ogni finestra. */
import Foundation

enum AppInfo {
    static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "sviluppo" }
}
