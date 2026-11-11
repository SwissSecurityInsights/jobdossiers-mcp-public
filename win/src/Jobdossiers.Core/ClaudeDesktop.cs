namespace Jobdossiers;

/// <summary>
/// Trova il file di configurazione che Claude Desktop legge davvero, senza dipendere da un solo percorso fisso: le versioni per Windows lo hanno
/// spostato (installer classico: %APPDATA%\Claude; pacchetto MSIX: %LOCALAPPDATA%\Claude-Data\claude_&lt;codice del pacchetto&gt;, verificato con
/// «Edit config» a novembre 2026). Attenzione: Claude scrive file di lavoro anche in cartelle da cui non legge la configurazione
/// (per esempio %LOCALAPPDATA%\Claude), quindi l'attività recente è solo l'ultimo indizio. Ordine:
/// 1. il file scelto a mano; 2. la cartella Claude-Data del pacchetto MSIX, se esiste; 3. un file di configurazione con chiavi scritte da Claude
/// (le sue preferenze: l'app scrive solo mcpServers), il più recente; 4. l'installazione classica; 5. pacchetto MSIX mai avviato;
/// 6. un file di configurazione qualunque, poi la cartella dati usata più di recente (posizioni future sconosciute).
/// </summary>
public static class ClaudeDesktop
{
    public const string ConfigName = "claude_desktop_config.json";
    /// <summary>File che Claude Desktop (app Electron) scrive nella sua cartella dati.</summary>
    static readonly string[] Activity = ["Local State", "Preferences", Path.Combine("logs", "main.log"), Path.Combine("logs", "mcp.log")];

    public sealed record Location(string File, string Why);

    static IEnumerable<string> Subdirs(string dir)
    {
        if (dir == "") return [];
        try { return Directory.Exists(dir) ? Directory.GetDirectories(dir) : []; } catch (Exception) { return []; }
    }

    /// <summary>Cartelle in cui Claude potrebbe tenere i dati: quelle con «claude» nel nome sotto %APPDATA% e %LOCALAPPDATA% e le loro sottocartelle, più la cartella virtualizzata dei pacchetti MSIX.</summary>
    public static IEnumerable<string> CandidateDirs(McpClients.Roots r)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var root in new[] { r.AppData, r.LocalAppData })
            foreach (var top in Subdirs(root).Where(d => Path.GetFileName(d).Contains("claude", StringComparison.OrdinalIgnoreCase)))
            {
                if (seen.Add(top)) yield return top;
                foreach (var sub in Subdirs(top)) if (seen.Add(sub)) yield return sub;
            }
        foreach (var pkg in Packages(r))
        {
            var v = Path.Combine(pkg, "LocalCache", "Roaming", "Claude");
            if (Directory.Exists(v) && seen.Add(v)) yield return v;
        }
    }

    static IEnumerable<string> Packages(McpClients.Roots r) =>
        Subdirs(r.LocalAppData == "" ? "" : Path.Combine(r.LocalAppData, "Packages")).Where(d => Path.GetFileName(d).StartsWith("Claude_", StringComparison.OrdinalIgnoreCase)).OrderBy(d => d, StringComparer.Ordinal);

    /// <summary>Ultima scrittura di Claude nella cartella; null se la cartella non contiene file di Claude.</summary>
    static DateTime? LastActivity(string dir)
    {
        DateTime? last = null;
        foreach (var f in Activity)
        {
            var p = Path.Combine(dir, f);
            if (File.Exists(p)) { var t = File.GetLastWriteTimeUtc(p); if (last is null || t > last) last = t; }
        }
        return last;
    }

    /// <summary>Il file contiene chiavi diverse da mcpServers, cioè l'ha scritto anche Claude (le sue preferenze).</summary>
    static bool WrittenByClaude(string file)
    {
        try { return System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(file)) is System.Text.Json.Nodes.JsonObject o && o.Any(kv => kv.Key != "mcpServers"); }
        catch (Exception) { return false; }
    }

    static string? MsixDataDir(McpClients.Roots r, string pkg)
    {
        var root = Path.Combine(r.LocalAppData, "Claude-Data");
        return Subdirs(root).FirstOrDefault(d => string.Equals(Path.GetFileName(d), Path.GetFileName(pkg), StringComparison.OrdinalIgnoreCase));
    }

    public static Location? Find(McpClients.Roots r)
    {
        if (!string.IsNullOrWhiteSpace(r.ClaudeConfig)) return new(r.ClaudeConfig!, "scelto a mano");
        var pkg = Packages(r).FirstOrDefault();
        var data = pkg is null ? null : MsixDataDir(r, pkg);
        if (data is not null) return new(Path.Combine(data, ConfigName), "pacchetto MSIX, cartella Claude-Data");
        var dirs = CandidateDirs(r).ToList();
        var configs = dirs.Select(d => Path.Combine(d, ConfigName)).Where(File.Exists).OrderByDescending(File.GetLastWriteTimeUtc).ThenBy(f => f, StringComparer.Ordinal).ToList();
        var byClaude = configs.FirstOrDefault(WrittenByClaude);
        if (byClaude is not null) return new(byClaude, "configurazione con le preferenze di Claude");
        var classic = Path.Combine(r.AppData, "Claude");
        if (Directory.Exists(classic) || (r.LocalAppData != "" && Directory.Exists(Path.Combine(r.LocalAppData, "AnthropicClaude"))))
            return new(Path.Combine(classic, ConfigName), "installazione classica");
        if (pkg is not null) return new(Path.Combine(r.LocalAppData, "Claude-Data", Path.GetFileName(pkg).ToLowerInvariant(), ConfigName), "pacchetto MSIX, Claude non ancora avviato");
        if (configs.Count > 0) return new(configs[0], "configurazione esistente");
        var active = dirs.Select(d => (dir: d, t: LastActivity(d))).Where(x => x.t is not null).OrderByDescending(x => x.t).ThenBy(x => x.dir, StringComparer.Ordinal).FirstOrDefault();
        return active.dir is null ? null : new(Path.Combine(active.dir, ConfigName), "cartella di Claude usata più di recente");
    }
}
