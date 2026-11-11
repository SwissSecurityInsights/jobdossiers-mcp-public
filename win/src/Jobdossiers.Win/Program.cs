namespace Jobdossiers.Win;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        if (args.Contains("--cleanup")) return Cleanup();
        // Una sola istanza: un secondo avvio non apre una seconda icona.
        using var single = new Mutex(true, @"Local\Jobdossiers.Tray", out var first);
        if (!first) return 0;
        ApplicationConfiguration.Initialize();
        Application.Run(new TrayApp(showSplash: true, openSettings: args.Contains("--settings")));     // --settings: apre subito le impostazioni (prova automatica in CI)
        return 0;
    }

    /// <summary>Per il disinstallatore: toglie la voce jobdossiers dai client che puntano a questo server e l'avvio all'accesso. Non tocca la chiave.</summary>
    static int Cleanup()
    {
        var roots = McpClients.Roots.Current();
        foreach (var c in McpClients.All)
        {
            try { if (McpClients.State(c, ServerHost.Installed, roots) == ClientState.Configured) McpClients.Remove(c, roots, ServerHost.Installed); }
            catch (Exception) { }
        }
        try { Startup.Enabled = false; } catch (Exception) { }
        return 0;
    }
}
