using Microsoft.Win32;

namespace Jobdossiers.Win;

/// <summary>Avvio all'accesso con la chiave Run dell'utente (nessun privilegio di amministratore). Il percorso si aggiorna se l'app viene spostata.</summary>
static class Startup
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run", Name = "Jobdossiers";
    static string Command => $"\"{Environment.ProcessPath}\"";

    public static bool Enabled
    {
        get { using var k = Registry.CurrentUser.OpenSubKey(RunKey); return k?.GetValue(Name) is string; }
        set
        {
            using var k = Registry.CurrentUser.CreateSubKey(RunKey);
            if (value) k.SetValue(Name, Command); else k.DeleteValue(Name, false);
        }
    }

    public static void RefreshPath() { if (Enabled) Enabled = true; }
}
