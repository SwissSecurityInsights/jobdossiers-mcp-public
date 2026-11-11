using System.Diagnostics;

namespace Jobdossiers.Win;

/// <summary>
/// La chiave jda1.… nel file che legge il server (src/store.js): %APPDATA%\jobdossiers-mcp\key.dpapi, cifrato con DPAPI per l'utente Windows.
/// Si cifra con lo stesso comando PowerShell del server (ConvertFrom-SecureString), passando la chiave da stdin: mai su riga di comando.
/// L'app non rilegge mai il valore.
/// </summary>
static class KeyStore
{
    public static string FilePath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "jobdossiers-mcp", "key.dpapi");
    const string PsEncrypt = "$k = [Console]::In.ReadLine(); ConvertTo-SecureString -String $k -AsPlainText -Force | ConvertFrom-SecureString";

    public static bool Exists() => File.Exists(FilePath);

    public static async Task SaveAsync(string raw)
    {
        var key = raw.Trim();
        if (!KeyFormat.IsValid(key)) throw new ArgumentException("La chiave deve avere la forma jda1.<token>.<segreto>, con token e segreto di 43 caratteri.");
        var psi = new ProcessStartInfo("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PsEncrypt])
            { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        using var p = Process.Start(psi) ?? throw new InvalidOperationException("PowerShell non disponibile.");
        await p.StandardInput.WriteLineAsync(key);
        p.StandardInput.Close();
        var enc = (await p.StandardOutput.ReadToEndAsync()).Trim();
        await p.WaitForExitAsync();
        if (p.ExitCode != 0 || enc.Length < 32) throw new InvalidOperationException("DPAPI non ha cifrato la chiave.");
        Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
        await File.WriteAllTextAsync(FilePath, enc);
    }

    public static void Delete() { if (File.Exists(FilePath)) File.Delete(FilePath); }
}
