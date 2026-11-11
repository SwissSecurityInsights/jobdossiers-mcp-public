using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

namespace Jobdossiers.Win;

/// <summary>
/// Il server MCP incluso: arriva accanto a Jobdossiers.exe e si copia in %LOCALAPPDATA%\Jobdossiers, un percorso fisso a cui puntano i client MCP
/// anche se l'app viene spostata. Se il server è in uso (un client lo ha avviato) la copia si rimanda.
/// </summary>
static class ServerHost
{
    public const string ExeName = "jobdossiers-mcp.exe";
    public static string Bundled => Path.Combine(AppContext.BaseDirectory, ExeName);
    public static string Installed => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Jobdossiers", ExeName);

    /// <summary>Copia il server incluso se manca o è diverso. → null se tutto a posto, altrimenti il motivo.</summary>
    public static string? Install()
    {
        if (!File.Exists(Bundled)) return File.Exists(Installed) ? null : $"Server non trovato accanto all'app ({ExeName}).";
        try
        {
            if (File.Exists(Installed) && Hash(Installed) == Hash(Bundled)) return null;
            Directory.CreateDirectory(Path.GetDirectoryName(Installed)!);
            File.Copy(Bundled, Installed, overwrite: true);
            return null;
        }
        catch (IOException) { return "Il server è in uso da un client MCP: chiudilo per aggiornare il server."; }
        catch (UnauthorizedAccessException) { return "Non è stato possibile copiare il server in " + Path.GetDirectoryName(Installed) + "."; }
    }

    static string Hash(string file) { using var s = File.OpenRead(file); return Convert.ToHexString(SHA256.HashData(s)); }

    /// <summary>Esegue `jobdossiers-mcp --check` (sola lettura). Il messaggio d'errore è quello del server, già senza segreti.</summary>
    public static async Task<CheckResult> CheckAsync()
    {
        var exe = File.Exists(Installed) ? Installed : Bundled;
        if (!File.Exists(exe)) throw new InvalidOperationException("Server MCP non trovato.");
        var psi = new ProcessStartInfo(exe, "--check") { RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true, UseShellExecute = false, CreateNoWindow = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
        using var p = Process.Start(psi) ?? throw new InvalidOperationException("Avvio del server non riuscito.");
        p.StandardInput.Close();
        var outTask = p.StandardOutput.ReadToEndAsync(); var errTask = p.StandardError.ReadToEndAsync();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        try { await p.WaitForExitAsync(cts.Token); }
        catch (OperationCanceledException) { try { p.Kill(true); } catch (Exception) { } throw new TimeoutException("Il server non ha risposto entro 60 secondi."); }
        var stdout = await outTask; var stderr = await errTask;
        if (p.ExitCode != 0) throw new InvalidOperationException(Short(stderr.Replace("Errore: ", "")));
        return CheckResult.Parse(stdout) ?? throw new InvalidOperationException("Risposta del server non leggibile.");
    }

    static string Short(string s) { s = s.Trim(); return s.Length > 300 ? s[..300] : (s == "" ? "Errore del server." : s); }
}
