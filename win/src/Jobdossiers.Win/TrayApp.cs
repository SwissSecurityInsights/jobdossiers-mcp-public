namespace Jobdossiers.Win;

/// <summary>
/// Icona nell'area di notifica: schede per stato (dal controllo in sola lettura del server, all'avvio e ogni ora), impostazioni, uscita.
/// All'avvio installa o aggiorna il server incluso e il percorso dell'avvio automatico.
/// </summary>
sealed class TrayApp : ApplicationContext
{
    readonly NotifyIcon icon;
    readonly ContextMenuStrip menu = new();
    readonly System.Windows.Forms.Timer hourly = new() { Interval = 3_600_000 };
    CheckResult? result; string? error; DateTime? lastCheck; bool checking;
    SettingsForm? settings;

    public string? ServerWarning { get; }

    public TrayApp(bool showSplash, bool openSettings = false)
    {
        ServerWarning = ServerHost.Install();
        try { Startup.RefreshPath(); } catch (Exception) { }
        icon = new NotifyIcon { Icon = AppIcon.Create(), Text = "Jobdossiers " + AppInfo.Version, Visible = true, ContextMenuStrip = menu };
        icon.DoubleClick += (_, _) => OpenSettings();
        menu.Opening += (_, _) => BuildMenu();
        BuildMenu();
        hourly.Tick += async (_, _) => await CheckAsync();
        hourly.Start();
        if (showSplash) new SplashForm(KeyStore.Exists()).Show();
        if (ServerWarning is not null) icon.ShowBalloonTip(8000, "Jobdossiers", ServerWarning, ToolTipIcon.Warning);
        _ = CheckAsync();
        if (openSettings) OpenSettings();
    }

    public void KeyChanged() { result = null; error = null; _ = CheckAsync(); }

    async Task CheckAsync()
    {
        if (checking || !KeyStore.Exists()) return;
        checking = true;
        try { result = await ServerHost.CheckAsync(); error = null; }
        catch (Exception ex) { error = ex.Message; }
        finally { checking = false; lastCheck = DateTime.Now; }
        var tip = result is null ? "Jobdossiers" : $"Jobdossiers · {result.Applications} schede";
        icon.Text = tip.Length > 63 ? tip[..63] : tip;
    }

    void BuildMenu()
    {
        menu.Items.Clear();
        menu.Items.Add(new ToolStripLabel("Jobdossiers") { Font = new Font(menu.Font, FontStyle.Bold) });
        if (!KeyStore.Exists()) Info("Nessuna chiave salvata");
        else if (result is not null)
        {
            Info($"{result.Applications} schede" + (result.Unreadable > 0 ? $", {result.Unreadable} non leggibili" : ""));
            foreach (var (status, count) in result.ByStatus) Info($"   {CheckResult.Label(status)}: {count}");
            Info("Quota: " + (result.Quota ?? "non comunicata dal portale"));
        }
        if (error is not null) Info("⚠ " + error);
        if (lastCheck is not null) Info("Controllo: " + lastCheck.Value.ToString("HH:mm"));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem(checking ? "Controllo…" : "Controlla ora", null, async (_, _) => await CheckAsync()) { Enabled = !checking && KeyStore.Exists() });
        menu.Items.Add(new ToolStripMenuItem("Impostazioni…", null, (_, _) => OpenSettings()));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Esci", null, (_, _) => Quit()));
    }

    void Info(string text) => menu.Items.Add(new ToolStripMenuItem(text) { Enabled = false });

    void OpenSettings()
    {
        if (settings is null || settings.IsDisposed) settings = new SettingsForm(this);
        settings.Show(); settings.WindowState = FormWindowState.Normal; settings.Activate();
    }

    void Quit()
    {
        hourly.Stop(); icon.Visible = false; icon.Dispose();
        settings?.Close();
        ExitThread();
    }
}
