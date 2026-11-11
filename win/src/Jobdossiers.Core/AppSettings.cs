using System.Text.Json.Nodes;

namespace Jobdossiers;

/// <summary>Impostazioni dell'app (non segrete) in %APPDATA%\Jobdossiers\settings.json: per ora solo il file di configurazione di Claude Desktop scelto a mano.</summary>
public static class AppSettings
{
    public static string DefaultPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Jobdossiers", "settings.json");

    public static string? ClaudeConfig(string? path = null)
    {
        try { return (JsonNode.Parse(File.ReadAllText(path ?? DefaultPath)) as JsonObject)?["claude_config"]?.GetValue<string>(); }
        catch (Exception) { return null; }
    }

    /// <summary>null o vuoto toglie la scelta: si torna alla ricerca automatica.</summary>
    public static void SetClaudeConfig(string? value, string? path = null)
    {
        var file = path ?? DefaultPath;
        JsonObject o;
        try { o = JsonNode.Parse(File.ReadAllText(file)) as JsonObject ?? new JsonObject(); } catch (Exception) { o = new JsonObject(); }
        if (string.IsNullOrWhiteSpace(value)) o.Remove("claude_config"); else o["claude_config"] = value;
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        File.WriteAllText(file, o.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
    }
}
