using System.Text.Json;
using System.Text.Json.Nodes;

namespace Jobdossiers;

/// <summary>Un client MCP che legge un file di configurazione JSON. I percorsi sono relativi a una radice (%APPDATA% o profilo utente).</summary>
/// <summary>Discover: il percorso della configurazione non è fisso e si cerca (Claude Desktop, vedi ClaudeDesktop). Toml: configurazione di ChatGPT e Codex (vedi CodexToml).</summary>
public sealed record McpClient(string Id, string Name, McpRoot Root, string Config, string Detect, string ServersKey = "mcpServers", string? Type = null, bool Discover = false, bool Toml = false);

public enum McpRoot { AppData, UserProfile }

public enum ClientState { NotInstalled, NotConfigured, Configured, Outdated, Unreadable }

/// <summary>
/// Registra il server nei client MCP di Windows. Tocca solo la voce "jobdossiers": le altre chiavi restano, nello stesso ordine.
/// Prima di scrivere fa una copia .jobdossiers.bak. Un file con commenti o non valido non si tocca.
/// </summary>
public static class McpClients
{
    public const string ServerName = "jobdossiers";

    /// <summary>Solo i client più diffusi (decisione dell'11.11.2026); il server funziona con qualunque client MCP, gli altri si collegano a mano (README).</summary>
    public static readonly McpClient[] All =
    [
        new("claude", "Claude Desktop", McpRoot.AppData, @"Claude\claude_desktop_config.json", "Claude", Discover: true),
        new("chatgpt", "ChatGPT (e Codex)", McpRoot.UserProfile, @".codex\config.toml", ".codex", Toml: true),
    ];

    /// <summary>Claude Code tiene la configurazione in un file che riscrive mentre gira: meglio il suo comando.</summary>
    public static string ClaudeCodeCommand(string command) => $"claude mcp add --scope user {ServerName} -- \"{command}\"";

    // ---------- file ----------

    /// <summary>ClaudeConfig: file di configurazione di Claude Desktop scelto a mano (AppSettings); se c'è vale su tutto.</summary>
    /// <summary>CodexHome: la variabile CODEX_HOME, se impostata, sposta la configurazione di ChatGPT e Codex.</summary>
    public sealed record Roots(string AppData, string UserProfile, string LocalAppData = "", string? ClaudeConfig = null, string? CodexHome = null)
    {
        public static Roots Current() => new(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppSettings.ClaudeConfig(), Environment.GetEnvironmentVariable("CODEX_HOME") is { Length: > 0 } h ? h : null);
        public string Path(McpRoot r, string rel) => System.IO.Path.Combine(r == McpRoot.AppData ? AppData : UserProfile, rel.Replace('\\', System.IO.Path.DirectorySeparatorChar));
    }

    /// <summary>File di configurazione che il client legge davvero, null se il client non è installato.</summary>
    public static string? ConfigFile(McpClient c, Roots r)
    {
        if (c.Discover) return ClaudeDesktop.Find(r)?.File;
        if (c.Toml && r.CodexHome is not null) return System.IO.Path.Combine(r.CodexHome, "config.toml");
        return Directory.Exists(r.Path(c.Root, c.Detect)) ? r.Path(c.Root, c.Config) : null;
    }

    public static ClientState State(McpClient c, string command, Roots roots)
    {
        var file = ConfigFile(c, roots);
        if (file is null) return ClientState.NotInstalled;
        if (!File.Exists(file)) return ClientState.NotConfigured;
        try
        {
            if (c.Toml) return CodexToml.State(File.ReadAllText(file), command);
            var cur = ConfiguredCommand(File.ReadAllText(file), c);
            return cur is null ? ClientState.NotConfigured : string.Equals(cur, command, StringComparison.OrdinalIgnoreCase) ? ClientState.Configured : ClientState.Outdated;
        }
        catch (Exception) { return ClientState.Unreadable; }
    }

    public static void Install(McpClient c, string command, Roots roots)
    {
        var file = ConfigFile(c, roots) ?? roots.Path(c.Root, c.Config);
        var text = File.Exists(file) ? File.ReadAllText(file) : null;
        Write(file, c.Toml ? CodexToml.Merged(text, command) : Merged(text, c, command));
    }

    /// <summary>command: l'eseguibile del server, per riconoscerne le voci anche con un altro nome (ChatGPT lascia scegliere il nome).</summary>
    public static void Remove(McpClient c, Roots roots, string command)
    {
        var file = ConfigFile(c, roots);
        if (file is null || !File.Exists(file)) return;
        var text = File.ReadAllText(file);
        Write(file, c.Toml ? CodexToml.Removed(text, command) : Removed(text, c));
    }

    static void Write(string file, string text)
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(file)!);
        if (File.Exists(file)) File.Copy(file, file + ".jobdossiers.bak", overwrite: true);
        var tmp = file + ".tmp";
        File.WriteAllText(tmp, text);
        File.Move(tmp, file, overwrite: true);
    }

    // ---------- JSON (funzioni pure, testate) ----------

    static readonly JsonSerializerOptions Out = new() { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public sealed class UnreadableException() : Exception("File di configurazione non leggibile (JSON non valido o con commenti): modificalo a mano.");

    static JsonObject Parse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return new JsonObject();
        try { return JsonNode.Parse(text) as JsonObject ?? throw new UnreadableException(); }
        catch (JsonException) { throw new UnreadableException(); }
    }

    public static JsonObject Entry(McpClient c, string command)
    {
        var e = new JsonObject();
        if (c.Type is not null) e["type"] = c.Type;
        e["command"] = command;
        e["args"] = new JsonArray();
        return e;
    }

    public static string? ConfiguredCommand(string text, McpClient c) =>
        Parse(text)[c.ServersKey]?[ServerName]?["command"]?.GetValue<string>();

    public static string Merged(string? text, McpClient c, string command)
    {
        var o = Parse(text);
        if (o[c.ServersKey] is not JsonObject servers) { servers = new JsonObject(); o[c.ServersKey] = servers; }
        servers[ServerName] = Entry(c, command);
        return o.ToJsonString(Out) + Environment.NewLine;
    }

    public static string Removed(string text, McpClient c)
    {
        var o = Parse(text);
        if (o[c.ServersKey] is JsonObject servers) servers.Remove(ServerName);
        return o.ToJsonString(Out) + Environment.NewLine;
    }
}
