namespace Jobdossiers;

/// <summary>
/// Configurazione di ChatGPT Desktop e Codex: %USERPROFILE%\.codex\config.toml (o %CODEX_HOME%\config.toml), un server per sezione
/// [mcp_servers.&lt;nome&gt;] con command ed eventuali sottosezioni ([mcp_servers.&lt;nome&gt;.env]). Verificato su Windows 11 l'11.11.2026:
/// ChatGPT salva il server aggiunto da Settings → MCP servers così, con command tra apici singoli, e lo usa sia nella Chat sia in Codex.
/// Si lavora riga per riga e si toccano solo le sezioni del nostro server: il resto del file (plugin, altri server, [desktop]) resta com'è.
/// </summary>
public static class CodexToml
{
    public const string Name = "jobdossiers";
    const string Prefix = "mcp_servers.";

    sealed record Block(string Server, bool Sub, int Start, int End);

    /// <summary>Nome della tabella di un'intestazione [..], null se la riga non è un'intestazione di tabella.</summary>
    static string? Header(string line)
    {
        var t = line.Trim();
        if (!t.StartsWith('[') || t.StartsWith("[[")) return null;
        var close = t.LastIndexOf(']');
        return close > 1 ? t[1..close].Trim() : null;
    }

    /// <summary>Divide un nome di tabella sui punti fuori dalle virgolette e toglie le virgolette.</summary>
    static List<string> Keys(string table)
    {
        var keys = new List<string>(); var cur = new System.Text.StringBuilder(); char q = '\0';
        foreach (var ch in table)
        {
            if (q != '\0') { if (ch == q) q = '\0'; else cur.Append(ch); }
            else if (ch is '"' or '\'') q = ch;
            else if (ch == '.') { keys.Add(cur.ToString().Trim()); cur.Clear(); }
            else cur.Append(ch);
        }
        keys.Add(cur.ToString().Trim());
        return keys;
    }

    /// <summary>Le tabelle dei server MCP con le righe che occupano (fino alla tabella successiva).</summary>
    static List<Block> Blocks(string[] lines)
    {
        var heads = new List<(int i, string? table)>();
        for (var i = 0; i < lines.Length; i++) { var h = Header(lines[i]); if (h is not null) heads.Add((i, h)); }
        var blocks = new List<Block>();
        for (var k = 0; k < heads.Count; k++)
        {
            var keys = Keys(heads[k].table!);
            if (keys.Count < 2 || keys[0] != "mcp_servers") continue;
            blocks.Add(new Block(keys[1], keys.Count > 2, heads[k].i, k + 1 < heads.Count ? heads[k + 1].i : lines.Length));
        }
        return blocks;
    }

    /// <summary>Valore di una riga «chiave = 'x'» o «chiave = "x"», null se la riga è un'altra.</summary>
    static string? Value(string line, string key)
    {
        var t = line.Trim();
        if (!t.StartsWith(key)) return null;
        var rest = t[key.Length..].TrimStart();
        if (!rest.StartsWith('=')) return null;
        rest = rest[1..].Trim();
        if (rest.Length >= 2 && rest[0] == '\'' ) { var e = rest.IndexOf('\'', 1); return e > 0 ? rest[1..e] : null; }
        if (rest.Length >= 2 && rest[0] == '"')
        {
            var sb = new System.Text.StringBuilder();
            for (var i = 1; i < rest.Length; i++)
            {
                if (rest[i] == '\\' && i + 1 < rest.Length) { sb.Append(rest[++i] switch { 'n' => '\n', 't' => '\t', var c => c }); continue; }
                if (rest[i] == '"') return sb.ToString();
                sb.Append(rest[i]);
            }
        }
        return null;
    }

    static string? Command(string[] lines, Block b) =>
        lines[(b.Start + 1)..b.End].Select(l => Value(l, "command")).FirstOrDefault(v => v is not null);

    /// <summary>Stringa TOML per un percorso: letterale tra apici singoli (come la scrive ChatGPT), con escape solo se il percorso contiene un apice.</summary>
    public static string Quote(string s) => s.Contains('\'') ? "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"" : "'" + s + "'";

    static string[] Lines(string? text) => (text ?? "").Replace("\r\n", "\n").Split('\n');

    /// <summary>Nomi dei server che puntano a questo eseguibile (stesso percorso, maiuscole indifferenti come su Windows).</summary>
    public static List<string> ServersFor(string? text, string command)
    {
        var lines = Lines(text);
        return Blocks(lines).Where(b => !b.Sub && string.Equals(Command(lines, b), command, StringComparison.OrdinalIgnoreCase)).Select(b => b.Server).ToList();
    }

    public static ClientState State(string? text, string command)
    {
        if (ServersFor(text, command).Count > 0) return ClientState.Configured;
        var lines = Lines(text);
        return Blocks(lines).Any(b => !b.Sub && b.Server == Name) ? ClientState.Outdated : ClientState.NotConfigured;
    }

    /// <summary>Aggiunge [mcp_servers.jobdossiers] (o ne aggiorna command se punta a un altro eseguibile); se un server punta già qui, non cambia nulla.</summary>
    public static string Merged(string? text, string command)
    {
        if (ServersFor(text, command).Count > 0) return text ?? "";
        var lines = Lines(text).ToList();
        var own = Blocks(lines.ToArray()).FirstOrDefault(b => !b.Sub && b.Server == Name);
        var cmdLine = "command = " + Quote(command);
        if (own is not null)
        {
            var at = Enumerable.Range(own.Start + 1, own.End - own.Start - 1).FirstOrDefault(i => Value(lines[i], "command") is not null, -1);
            if (at >= 0) lines[at] = cmdLine; else lines.Insert(own.Start + 1, cmdLine);
            return string.Join(Environment.NewLine, lines);
        }
        while (lines.Count > 0 && lines[^1].Trim() == "") lines.RemoveAt(lines.Count - 1);
        if (lines.Count > 0) lines.Add("");
        lines.AddRange(["[" + Prefix + Name + "]", cmdLine, "args = []", ""]);
        return string.Join(Environment.NewLine, lines);
    }

    /// <summary>Toglie i server che puntano a questo eseguibile e [mcp_servers.jobdossiers], con le loro sottosezioni; il resto resta com'è.</summary>
    public static string Removed(string text, string command)
    {
        var names = ServersFor(text, command).Append(Name).ToHashSet();
        var lines = Lines(text);
        var drop = new HashSet<int>();
        foreach (var b in Blocks(lines).Where(b => names.Contains(b.Server)))
            for (var i = b.Start; i < b.End; i++) drop.Add(i);
        return string.Join(Environment.NewLine, lines.Where((_, i) => !drop.Contains(i)));
    }
}
