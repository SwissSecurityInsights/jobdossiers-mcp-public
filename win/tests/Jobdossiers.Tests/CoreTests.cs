using System.Text.Json.Nodes;
using Jobdossiers;
using Xunit;

public class CoreTests
{
    static readonly McpClient Claude = McpClients.All.First(c => c.Id == "claude");
    /// <summary>Client JSON con chiave «servers» e tipo, come certi editor: le funzioni restano anche se non è più nell'elenco dei client.</summary>
    static readonly McpClient VsCode = new("vscode", "VS Code", McpRoot.AppData, @"Code\User\mcp.json", @"Code\User", "servers", "stdio");
    static readonly McpClient ChatGpt = McpClients.All.First(c => c.Id == "chatgpt");
    const string Cmd = @"C:\Users\anna\AppData\Local\Jobdossiers\jobdossiers-mcp.exe";

    [Fact]
    public void FormatoChiave()
    {
        var t = new string('A', 43);
        Assert.True(KeyFormat.IsValid($"jda1.{t}.{t}"));
        Assert.True(KeyFormat.IsValid($"  jda1.{t}.{t}\n"));
        Assert.False(KeyFormat.IsValid($"jda1.{t}.short"));
        Assert.False(KeyFormat.IsValid($"jda2.{t}.{t}"));
        Assert.False(KeyFormat.IsValid($"jda1.{t}.{t[..42]}+"));
        Assert.False(KeyFormat.IsValid(null));
    }

    [Fact]
    public void NuovoFile()
    {
        var o = JsonNode.Parse(McpClients.Merged(null, Claude, Cmd))!;
        Assert.Equal(Cmd, o["mcpServers"]!["jobdossiers"]!["command"]!.GetValue<string>());
        Assert.Empty(o["mcpServers"]!["jobdossiers"]!["args"]!.AsArray());
    }

    [Fact]
    public void ConservaAltriServerChiaviEOrdine()
    {
        const string before = """{"globalShortcut":"Ctrl+K","mcpServers":{"altro":{"command":"C:\\altro.exe","env":{"TOKEN":"x"}}},"zeta":1}""";
        var text = McpClients.Merged(before, Claude, Cmd);
        var o = JsonNode.Parse(text)!.AsObject();
        Assert.Equal(["globalShortcut", "mcpServers", "zeta"], o.Select(kv => kv.Key).ToArray());
        Assert.Equal("x", o["mcpServers"]!["altro"]!["env"]!["TOKEN"]!.GetValue<string>());
        Assert.Equal(Cmd, McpClients.ConfiguredCommand(text, Claude));
        Assert.Contains(@"C:\\Users\\anna", text);     // percorso Windows scritto come JSON valido
    }

    [Fact]
    public void VsCodeUsaServersETipo()
    {
        var o = JsonNode.Parse(McpClients.Merged("{}", VsCode, Cmd))!;
        Assert.Equal("stdio", o["servers"]!["jobdossiers"]!["type"]!.GetValue<string>());
        Assert.Null(o["mcpServers"]);
    }

    [Fact]
    public void Rimozione()
    {
        var d = McpClients.Merged("""{"mcpServers":{"altro":{"command":"a"}}}""", Claude, Cmd);
        var r = McpClients.Removed(d, Claude);
        Assert.Null(McpClients.ConfiguredCommand(r, Claude));
        Assert.NotNull(JsonNode.Parse(r)!["mcpServers"]!["altro"]);
    }

    [Fact]
    public void JsonConCommentiRifiutato()
    {
        Assert.Throws<McpClients.UnreadableException>(() => McpClients.Merged("{\n // commento\n \"servers\": {}\n}", VsCode, Cmd));
        Assert.Throws<McpClients.UnreadableException>(() => McpClients.Merged("[1,2]", VsCode, Cmd));
    }

    [Fact]
    public void ComandoClaudeCode() =>
        Assert.Equal($"claude mcp add --scope user jobdossiers -- \"{Cmd}\"", McpClients.ClaudeCodeCommand(Cmd));

    [Fact]
    public void StatoDaiFile()
    {
        var dir = Directory.CreateTempSubdirectory("jd-win-");
        try
        {
            var roots = new McpClients.Roots(Path.Combine(dir.FullName, "AppData"), Path.Combine(dir.FullName, "Profile"));
            Assert.Equal(ClientState.NotInstalled, McpClients.State(Claude, Cmd, roots));
            Directory.CreateDirectory(roots.Path(McpRoot.AppData, "Claude"));
            Assert.Equal(ClientState.NotConfigured, McpClients.State(Claude, Cmd, roots));
            McpClients.Install(Claude, Cmd, roots);
            Assert.Equal(ClientState.Configured, McpClients.State(Claude, Cmd, roots));
            Assert.Equal(ClientState.Outdated, McpClients.State(Claude, @"D:\altro\jobdossiers-mcp.exe", roots));
            McpClients.Install(Claude, Cmd, roots);
            Assert.True(File.Exists(roots.Path(McpRoot.AppData, @"Claude\claude_desktop_config.json.jobdossiers.bak")));
            McpClients.Remove(Claude, roots, Cmd);
            Assert.Equal(ClientState.NotConfigured, McpClients.State(Claude, Cmd, roots));
            File.WriteAllText(roots.Path(McpRoot.AppData, @"Claude\claude_desktop_config.json"), "{ // no");
            Assert.Equal(ClientState.Unreadable, McpClients.State(Claude, Cmd, roots));
            Assert.Throws<McpClients.UnreadableException>(() => McpClients.Install(Claude, Cmd, roots));
        }
        finally { dir.Delete(true); }
    }

    // ---------- ricerca del file di Claude Desktop ----------

    static McpClients.Roots TempRoots(DirectoryInfo dir, string? manual = null) =>
        new(Path.Combine(dir.FullName, "Roaming"), Path.Combine(dir.FullName, "Profile"), Path.Combine(dir.FullName, "Local"), manual);

    /// <summary>Cartella dati di Claude con «Local State» scritto all'ora data.</summary>
    static string ClaudeData(string dir, DateTime when)
    {
        Directory.CreateDirectory(dir);
        var f = Path.Combine(dir, "Local State"); File.WriteAllText(f, "{}"); File.SetLastWriteTimeUtc(f, when);
        return Path.Combine(dir, "claude_desktop_config.json");
    }

    static void InTemp(Action<DirectoryInfo> test) { var d = Directory.CreateTempSubdirectory("jd-claude-"); try { test(d); } finally { d.Delete(true); } }

    [Fact]
    public void ClaudeMsixMaiAvviato() => InTemp(d =>
    {
        var r = TempRoots(d);
        Assert.Equal(ClientState.NotInstalled, McpClients.State(Claude, Cmd, r));
        Directory.CreateDirectory(Path.Combine(r.LocalAppData, "Packages", "Claude_pzs8sxrjxfjjc"));
        var stale = Path.Combine(r.LocalAppData, "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude");
        Directory.CreateDirectory(stale); File.WriteAllText(Path.Combine(stale, "claude_desktop_config.json"), """{"mcpServers":{}}""");   // lasciato da una versione precedente dell'app
        var loc = ClaudeDesktop.Find(r)!;
        Assert.Equal(Path.Combine(r.LocalAppData, "Claude-Data", "claude_pzs8sxrjxfjjc", "claude_desktop_config.json"), loc.File);
        Assert.Contains("non ancora avviato", loc.Why);
    });

    [Fact]
    public void ClaudeMsixComeSuWindows11() => InTemp(d =>
    {
        var r = TempRoots(d);
        Directory.CreateDirectory(Path.Combine(r.LocalAppData, "Packages", "Claude_pzs8sxrjxfjjc"));
        var file = Path.Combine(r.LocalAppData, "Claude-Data", "claude_pzs8sxrjxfjjc", "claude_desktop_config.json");
        Directory.CreateDirectory(Path.GetDirectoryName(file)!); File.WriteAllText(file, """{"preferences":{"x":1}}""");
        ClaudeData(Path.Combine(r.LocalAppData, "Claude"), DateTime.UtcNow.AddMinutes(5));         // file di lavoro più recenti altrove: non contano (caso visto su Windows 11)
        Assert.Equal(file, ClaudeDesktop.Find(r)!.File);
        Assert.Equal(ClientState.NotConfigured, McpClients.State(Claude, Cmd, r));
        McpClients.Install(Claude, Cmd, r);
        Assert.Equal(ClientState.Configured, McpClients.State(Claude, Cmd, r));
        Assert.Equal(1, JsonNode.Parse(File.ReadAllText(file))!["preferences"]!["x"]!.GetValue<int>());
        Assert.False(Directory.Exists(Path.Combine(r.AppData, "Claude")), "niente scritto nella posizione classica");
        McpClients.Remove(Claude, r, Cmd);
        Assert.Null(McpClients.ConfiguredCommand(File.ReadAllText(file), Claude));
    });

    [Fact]
    public void ClaudeVinceLaConfigurazioneConLePreferenze() => InTemp(d =>
    {
        var r = TempRoots(d);
        ClaudeData(Path.Combine(r.LocalAppData, "Claude"), DateTime.UtcNow);                                     // file di lavoro, nessuna configurazione
        var old = Path.Combine(r.LocalAppData, "Claude-Next", "a", "claude_desktop_config.json");
        var cur = Path.Combine(r.LocalAppData, "Claude-Next", "b", "claude_desktop_config.json");
        foreach (var (f, t) in new[] { (old, DateTime.UtcNow.AddDays(-3)), (cur, DateTime.UtcNow.AddHours(-1)) })
        { Directory.CreateDirectory(Path.GetDirectoryName(f)!); File.WriteAllText(f, """{"preferences":{}}"""); File.SetLastWriteTimeUtc(f, t); }
        var loc = ClaudeDesktop.Find(r)!;
        Assert.Equal(cur, loc.File);                                                                             // posizione nuova, la più recente con le preferenze di Claude
        Assert.Contains("preferenze", loc.Why);
    });

    [Fact]
    public void ClaudeClassicaPrimaDeiFileDiLavoro() => InTemp(d =>
    {
        var r = TempRoots(d);
        Directory.CreateDirectory(Path.Combine(r.AppData, "Claude"));
        ClaudeData(Path.Combine(r.LocalAppData, "Claude"), DateTime.UtcNow);
        Assert.Equal(Path.Combine(r.AppData, "Claude", "claude_desktop_config.json"), ClaudeDesktop.Find(r)!.File);
    });

    [Fact]
    public void ClaudeInUnaPosizioneSconosciuta() => InTemp(d =>
    {
        var r = TempRoots(d);
        var future = ClaudeData(Path.Combine(r.LocalAppData, "AnthropicClaude-Profiles", "default"), DateTime.UtcNow);   // nessun altro indizio: ultima risorsa
        Assert.Equal(future, ClaudeDesktop.Find(r)!.File);
        Assert.Equal(ClientState.NotConfigured, McpClients.State(Claude, Cmd, r));
    });

    [Fact]
    public void ClaudeFileSceltoAMano() => InTemp(d =>
    {
        var settings = Path.Combine(d.FullName, "settings.json");
        Assert.Null(AppSettings.ClaudeConfig(settings));
        var manual = Path.Combine(d.FullName, "altrove", "claude_desktop_config.json");
        AppSettings.SetClaudeConfig(manual, settings);
        Assert.Equal(manual, AppSettings.ClaudeConfig(settings));
        ClaudeData(Path.Combine(TempRoots(d).AppData, "Claude"), DateTime.UtcNow);
        var r = TempRoots(d, AppSettings.ClaudeConfig(settings));
        Assert.Equal(manual, ClaudeDesktop.Find(r)!.File);
        McpClients.Install(Claude, Cmd, r);
        Assert.True(File.Exists(manual));
        AppSettings.SetClaudeConfig(null, settings);
        Assert.Null(AppSettings.ClaudeConfig(settings));
    });

    [Fact]
    public void SoloClaudeEChatGpt() => Assert.Equal(["claude", "chatgpt"], McpClients.All.Select(c => c.Id).ToArray());

    // ---------- ChatGPT e Codex (config.toml) ----------

    /// <summary>Struttura del config.toml di ChatGPT Desktop visto su Windows 11 (intestazioni e command reali, il resto ridotto).</summary>
    const string CodexReale = """
        model = "gpt-5"

        [marketplaces.openai-bundled]
        enabled = true

        [plugins."browser@openai-bundled"]
        enabled = true

        [mcp_servers.node_repl]
        args = []
        command = 'C:\Users\anna\AppData\Local\OpenAI\Codex\runtimes\cua_node\6a65cf502bc2ed2a\bin\node_repl.exe'

        [mcp_servers.node_repl.env]
        NODE_OPTIONS = "--x"

        [mcp_servers.jobdossier-locale]
        command = 'C:\Users\anna\AppData\Local\Jobdossiers\jobdossiers-mcp.exe'

        [desktop]
        theme = "dark"
        """;

    [Fact]
    public void CodexServerAggiuntoDaChatGpt()
    {
        Assert.Equal(["jobdossier-locale"], CodexToml.ServersFor(CodexReale, Cmd));
        Assert.Equal(ClientState.Configured, CodexToml.State(CodexReale, Cmd));
        Assert.Equal(CodexReale, CodexToml.Merged(CodexReale, Cmd));                                  // già configurato con un altro nome: nessuna modifica
        var r = CodexToml.Removed(CodexReale, Cmd);
        Assert.Equal(ClientState.NotConfigured, CodexToml.State(r, Cmd));
        foreach (var keep in new[] { "[mcp_servers.node_repl]", "[mcp_servers.node_repl.env]", "NODE_OPTIONS", "[desktop]", "theme = \"dark\"", "[plugins.\"browser@openai-bundled\"]", "model = \"gpt-5\"" })
            Assert.Contains(keep, r);
        Assert.DoesNotContain("jobdossier-locale", r);
    }

    [Fact]
    public void CodexConfiguraEAggiorna()
    {
        var senza = CodexToml.Removed(CodexReale, Cmd);
        var con = CodexToml.Merged(senza, Cmd);
        Assert.Contains("[mcp_servers.jobdossiers]", con);
        Assert.Contains("command = '" + Cmd + "'", con);
        Assert.Equal(ClientState.Configured, CodexToml.State(con, Cmd));
        Assert.StartsWith(senza.TrimEnd(), con);                                                     // il resto del file resta uguale, la sezione va in fondo
        var altro = con.Replace(Cmd, @"D:\vecchio\jobdossiers-mcp.exe") + "\n[mcp_servers.jobdossiers.env]\nX = \"1\"\n";
        Assert.Equal(ClientState.Outdated, CodexToml.State(altro, Cmd));
        var agg = CodexToml.Merged(altro, Cmd);
        Assert.Equal(ClientState.Configured, CodexToml.State(agg, Cmd));
        Assert.Contains("X = \"1\"", agg);                                                           // aggiornato solo command
        Assert.DoesNotContain("[mcp_servers.jobdossiers", CodexToml.Removed(agg, Cmd));               // via anche la sottosezione .env
        Assert.Equal("command = \"C:\\\\Users\\\\o'brien\\\\x.exe\"", "command = " + CodexToml.Quote(@"C:\Users\o'brien\x.exe"));
        Assert.Equal(["jobdossiers"], CodexToml.ServersFor(CodexToml.Merged("", @"C:\Users\o'brien\x.exe"), @"C:\Users\o'brien\x.exe"));
    }

    [Fact]
    public void CodexDaiFile()
    {
        var dir = Directory.CreateTempSubdirectory("jd-codex-");
        try
        {
            var roots = new McpClients.Roots(Path.Combine(dir.FullName, "Roaming"), Path.Combine(dir.FullName, "Profile"));
            Assert.Equal(ClientState.NotInstalled, McpClients.State(ChatGpt, Cmd, roots));
            Directory.CreateDirectory(Path.Combine(roots.UserProfile, ".codex"));
            Assert.Equal(ClientState.NotConfigured, McpClients.State(ChatGpt, Cmd, roots));
            var file = Path.Combine(roots.UserProfile, ".codex", "config.toml");
            File.WriteAllText(file, CodexReale);
            Assert.Equal(ClientState.Configured, McpClients.State(ChatGpt, Cmd, roots));
            McpClients.Remove(ChatGpt, roots, Cmd);
            Assert.Equal(ClientState.NotConfigured, McpClients.State(ChatGpt, Cmd, roots));
            Assert.True(File.Exists(file + ".jobdossiers.bak"));
            McpClients.Install(ChatGpt, Cmd, roots);
            Assert.Equal(ClientState.Configured, McpClients.State(ChatGpt, Cmd, roots));
            var home = Path.Combine(dir.FullName, "codexhome");                                        // CODEX_HOME sposta la configurazione
            Assert.Equal(Path.Combine(home, "config.toml"), McpClients.ConfigFile(ChatGpt, roots with { CodexHome = home }));
        }
        finally { dir.Delete(true); }
    }

    [Fact]
    public void LetturaDelCheck()
    {
        var r = CheckResult.Parse("""{"ok":true,"applications":5,"unreadable":1,"by_status":{"sent":2,"preparing":1,"zzz":1,"deleted":1},"quota":null}""")!;
        Assert.Equal(5, r.Applications);
        Assert.Equal(1, r.Unreadable);
        Assert.Equal(["preparing", "sent", "deleted", "zzz"], r.ByStatus.Select(x => x.Status).ToArray());
        Assert.Null(r.Quota);
        Assert.Equal("In preparazione", CheckResult.Label("preparing"));
        Assert.Equal("Colloquio", CheckResult.Label("interview"));
        Assert.Equal("Colloquio HR", CheckResult.Label("hr_interview"));
        Assert.Equal("zzz", CheckResult.Label("zzz"));
        Assert.Null(CheckResult.Parse("non json"));
        Assert.Null(CheckResult.Parse("""{"ok":false}"""));
        Assert.Equal("""{"used":3}""", CheckResult.Parse("""{"ok":true,"quota":{"used":3}}""")!.Quota);
    }
}
