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

    /// <summary>Collega il PC dal browser (`--login`, docs/collega-dispositivo.md): il server apre il browser, riceve la chiave cifrata per lui
    /// e la salva con DPAPI. Qui arriva solo l'esito (numero di schede), mai la chiave.</summary>
    public static async Task<int> LinkAsync(string deviceName)
    {
        var exe = File.Exists(Installed) ? Installed : Bundled;
        if (!File.Exists(exe)) throw new InvalidOperationException("Server MCP non trovato.");
        var psi = new ProcessStartInfo(exe) { RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true, UseShellExecute = false, CreateNoWindow = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
        psi.ArgumentList.Add("--login"); psi.ArgumentList.Add("--name"); psi.ArgumentList.Add(deviceName);
        using var p = Process.Start(psi) ?? throw new InvalidOperationException("Avvio del server non riuscito.");
        p.StandardInput.Close();
        var outTask = p.StandardOutput.ReadToEndAsync(); var errTask = p.StandardError.ReadToEndAsync();
        using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(6));
        try { await p.WaitForExitAsync(cts.Token); }
        catch (OperationCanceledException) { try { p.Kill(true); } catch (Exception) { } throw new TimeoutException("Nessuna risposta dal browser entro 6 minuti."); }
        var stdout = await outTask; var stderr = await errTask;
        if (p.ExitCode != 0) throw new InvalidOperationException(Short(stderr.Replace("Errore: ", "")));
        try { return System.Text.Json.JsonDocument.Parse(stdout).RootElement.GetProperty("applications").GetInt32(); }
        catch (Exception) { throw new InvalidOperationException("Risposta del server non leggibile."); }
    }

    static async Task<string> RunAsync(TimeSpan timeout, params string[] args)
    {
        var exe = File.Exists(Installed) ? Installed : Bundled;
        if (!File.Exists(exe)) throw new InvalidOperationException("Server MCP non trovato.");
        var psi = new ProcessStartInfo(exe) { RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true, UseShellExecute = false, CreateNoWindow = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi) ?? throw new InvalidOperationException("Avvio del server non riuscito.");
        p.StandardInput.Close();
        var outTask = p.StandardOutput.ReadToEndAsync(); var errTask = p.StandardError.ReadToEndAsync();
        using var cts = new CancellationTokenSource(timeout);
        try { await p.WaitForExitAsync(cts.Token); }
        catch (OperationCanceledException) { try { p.Kill(true); } catch (Exception) { } throw new TimeoutException("Il server non ha risposto in tempo."); }
        var stdout = await outTask; var stderr = await errTask;
        if (p.ExitCode != 0) throw new InvalidOperationException(Short(stderr.Replace("Errore: ", "")));
        return stdout;
    }

    /// <summary>Versione più nuova dell'app, se c'è (latest.json firmato della release, verificato dal server; src/update.js).</summary>
    public static async Task<string?> CheckAppUpdateAsync()
    {
        using var j = System.Text.Json.JsonDocument.Parse(await RunAsync(TimeSpan.FromSeconds(60), "--app-update-check"));
        return j.RootElement.TryGetProperty("available", out var a) && a.GetBoolean() ? j.RootElement.GetProperty("version").GetString() : null;
    }

    /// <summary>Scarica l'installer e lo controlla con l'impronta firmata. → percorso del Setup.exe</summary>
    public static async Task<string> DownloadAppUpdateAsync()
    {
        using var j = System.Text.Json.JsonDocument.Parse(await RunAsync(TimeSpan.FromMinutes(15), "--app-update-download"));
        return j.RootElement.TryGetProperty("path", out var p) && p.GetString() is { Length: > 0 } s ? s : throw new InvalidOperationException("Nessun aggiornamento da installare.");
    }

    static string Short(string s) { s = s.Trim(); return s.Length > 300 ? s[..300] : (s == "" ? "Errore del server." : s); }
}
