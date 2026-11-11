import Foundation
import XCTest
@testable import Jobdossiers

final class ClientsTests: XCTestCase {
    let claude = Clients.all.first { $0.id == "claude" }!
    /// Client JSON con chiave «servers» e tipo, come certi editor: le funzioni restano anche se non è più nell'elenco dei client.
    let vscode = MCPClient(id: "vscode", name: "VS Code", config: "Library/Application Support/Code/User/mcp.json", detect: "Library/Application Support/Code/User", serversKey: "servers", extra: ["type": "stdio"])
    let cmd = "/Applications/Jobdossiers.app/Contents/Resources/jobdossiers-mcp"

    private func json(_ d: Data) throws -> [String: Any] { try JSONSerialization.jsonObject(with: d) as! [String: Any] }

    func testNuovoFile() throws {
        let o = try json(Clients.merged(nil, client: claude, command: cmd))
        let e = (o["mcpServers"] as! [String: Any])["jobdossiers"] as! [String: Any]
        XCTAssertEqual(e["command"] as? String, cmd)
        XCTAssertEqual(e["args"] as? [String], [])
    }

    func testConservaAltriServerEChiavi() throws {
        let before = Data(#"{"globalShortcut":"Cmd+K","mcpServers":{"altro":{"command":"/bin/altro","env":{"TOKEN":"x"}}}}"#.utf8)
        let o = try json(Clients.merged(before, client: claude, command: cmd))
        XCTAssertEqual(o["globalShortcut"] as? String, "Cmd+K")
        let servers = o["mcpServers"] as! [String: Any]
        XCTAssertEqual(((servers["altro"] as! [String: Any])["env"] as! [String: String])["TOKEN"], "x")
        XCTAssertNotNil(servers["jobdossiers"])
    }

    func testVSCodeUsaServersETipo() throws {
        let o = try json(Clients.merged(Data("{}".utf8), client: vscode, command: cmd))
        let e = (o["servers"] as! [String: Any])["jobdossiers"] as! [String: Any]
        XCTAssertEqual(e["type"] as? String, "stdio")
        XCTAssertNil(o["mcpServers"])
    }

    func testStatoERimozione() throws {
        let d = try Clients.merged(nil, client: claude, command: cmd)
        XCTAssertEqual(try Clients.configuredCommand(d, client: claude), cmd)
        let r = try Clients.removed(d, client: claude)
        XCTAssertNil(try Clients.configuredCommand(r, client: claude))
        XCTAssertNotNil(try json(r)["mcpServers"])
    }

    func testJSONConCommentiRifiutato() {
        let jsonc = Data("{\n  // commento\n  \"servers\": {}\n}".utf8)
        XCTAssertThrowsError(try Clients.merged(jsonc, client: vscode, command: cmd))
    }

    func testSoloClaudeEChatGPT() { XCTAssertEqual(Clients.all.map(\.id), ["claude", "chatgpt"]) }

    // ChatGPT e Codex: struttura del config.toml che ChatGPT ha scritto su macOS (intestazioni e command reali, il resto ridotto)
    let codexMac = """
    model = "gpt-5"

    [plugins."browser@openai-bundled"]
    enabled = true

    [mcp_servers.node_repl]
    args = []
    command = "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl"

    [mcp_servers.node_repl.env]
    NODE_OPTIONS = "--x"

    [mcp_servers.jobdossiers_locale]
    enabled = true
    command = "/Applications/Jobdossiers.app/Contents/Resources/jobdossiers-mcp"
    """
    let serverMac = "/Applications/Jobdossiers.app/Contents/Resources/jobdossiers-mcp"

    func testCodexServerAggiuntoDaChatGPT() {
        XCTAssertEqual(CodexToml.servers(for: serverMac, in: codexMac), ["jobdossiers_locale"])
        XCTAssertEqual(CodexToml.state(codexMac, command: serverMac), .configured)
        XCTAssertEqual(CodexToml.merged(codexMac, command: serverMac), codexMac)
        let r = CodexToml.removed(codexMac, command: serverMac)
        XCTAssertEqual(CodexToml.state(r, command: serverMac), .notConfigured)
        for keep in ["[mcp_servers.node_repl]", "[mcp_servers.node_repl.env]", "NODE_OPTIONS", "[plugins.\"browser@openai-bundled\"]", "model = \"gpt-5\""] { XCTAssertTrue(r.contains(keep), keep) }
    }

    func testCodexConfiguraEAggiorna() {
        let senza = CodexToml.removed(codexMac, command: serverMac)
        let con = CodexToml.merged(senza, command: serverMac)
        XCTAssertTrue(con.contains("[mcp_servers.jobdossiers]\ncommand = \"\(serverMac)\"\nargs = []"))
        XCTAssertEqual(CodexToml.state(con, command: serverMac), .configured)
        XCTAssertTrue(con.hasPrefix(senza.trimmingCharacters(in: .whitespacesAndNewlines)))
        let altro = con.replacingOccurrences(of: serverMac, with: "/vecchio/jobdossiers-mcp") + "\n[mcp_servers.jobdossiers.env]\nX = \"1\"\n"
        XCTAssertEqual(CodexToml.state(altro, command: serverMac), .outdated)
        let agg = CodexToml.merged(altro, command: serverMac)
        XCTAssertEqual(CodexToml.state(agg, command: serverMac), .configured)
        XCTAssertTrue(agg.contains("X = \"1\""))
        XCTAssertFalse(CodexToml.removed(agg, command: serverMac).contains("[mcp_servers.jobdossiers"))
        XCTAssertEqual(CodexToml.quote(#"/a "b"\c"#), #""/a \"b\"\\c""#)
    }

    func testComandoClaudeCodeConApici() {
        XCTAssertEqual(Clients.claudeCodeCommand("/a/b'c"), #"claude mcp add --scope user jobdossiers -- '/a/b'\''c'"#)
    }

    func testFormatoChiave() {
        let t = String(repeating: "A", count: 43)
        XCTAssertTrue(KeyStore.isValid("jda1.\(t).\(t)"))
        XCTAssertFalse(KeyStore.isValid("jda1.\(t).short"))
        XCTAssertFalse(KeyStore.isValid("jda2.\(t).\(t)"))
        XCTAssertFalse(KeyStore.isValid("jda1.\(t).\(t.dropLast())+"))
    }
}
