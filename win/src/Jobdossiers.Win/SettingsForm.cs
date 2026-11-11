namespace Jobdossiers.Win;

/// <summary>Impostazioni: chiave per automazioni, avvio all'accesso, client MCP, server incluso.</summary>
sealed class SettingsForm : Form
{
    readonly TrayApp app;
    readonly Label keyState = Lbl("");
    readonly TextBox keyBox = new() { UseSystemPasswordChar = true, Width = 380, PlaceholderText = "jda1.…" };
    readonly Label keyMsg = Lbl("");
    readonly CheckBox startup = new() { Text = "Apri all'accesso a Windows", AutoSize = true };
    readonly FlowLayoutPanel clients = Column();
    readonly Label clientMsg = Lbl("");
    static McpClients.Roots roots => McpClients.Roots.Current();          // riletto ogni volta: la scelta a mano del file di Claude può cambiare

    public SettingsForm(TrayApp app)
    {
        this.app = app;
        Text = "Impostazioni Jobdossiers"; Icon = AppIcon.Create(); StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9.5f); ClientSize = new Size(560, 640); MinimumSize = new Size(480, 400);
        var root = Column(); root.Dock = DockStyle.Fill; root.AutoScroll = true; root.Padding = new Padding(16); root.AutoSize = false;

        var save = new Button { Text = "Salva", AutoSize = true };
        var del = new Button { Text = "Elimina chiave", AutoSize = true };
        save.Click += async (_, _) => await SaveKey(save);
        del.Click += (_, _) => DeleteKey();
        keyBox.KeyDown += async (_, e) => { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; await SaveKey(save); } };
        root.Controls.Add(Group("Chiave per automazioni", keyState, keyBox, Row(save, del), keyMsg,
            Note("La crei su jobdossiers.ch in Account → Chiave per automazioni (piano Plus). Viene cifrata con DPAPI per il tuo utente Windows e l'app non la rilegge mai.")));

        startup.Checked = Startup.Enabled;
        startup.CheckedChanged += (_, _) => { try { Startup.Enabled = startup.Checked; } catch (Exception ex) { MessageBox.Show(this, ex.Message, "Jobdossiers"); } };
        root.Controls.Add(Group("Avvio", startup));

        root.Controls.Add(Group("Client MCP", clients, clientMsg,
            Note("I client puntano al server installato in " + Path.GetDirectoryName(ServerHost.Installed) + ". Dopo Configura riavvia il client.")));

        root.Controls.Add(Group("Server", Lbl("In uso: " + (File.Exists(ServerHost.Installed) ? ServerHost.Installed : "non installato")),
            Note(app.ServerWarning ?? "Il server è aggiornato.")));
        Controls.Add(root);
        Activated += (_, _) => RefreshAll();
        RefreshAll();
    }

    void RefreshAll()
    {
        keyState.Text = KeyStore.Exists() ? "Stato: salvata (cifrata con DPAPI)" : "Stato: non salvata";
        BuildClients();
    }

    async Task SaveKey(Button save)
    {
        if (keyBox.Text.Trim() == "") return;
        save.Enabled = false;
        try { await KeyStore.SaveAsync(keyBox.Text); keyBox.Text = ""; Say(keyMsg, "Chiave salvata.", ok: true); app.KeyChanged(); }
        catch (Exception ex) { Say(keyMsg, ex.Message, ok: false); }
        finally { save.Enabled = true; RefreshAll(); }
    }

    void DeleteKey()
    {
        if (!KeyStore.Exists()) return;
        if (MessageBox.Show(this, "Il server MCP smetterà di funzionare finché non ne salvi una nuova. Per revocarla davvero usa anche il portale.", "Eliminare la chiave?", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning) != DialogResult.OK) return;
        try { KeyStore.Delete(); Say(keyMsg, "Chiave eliminata.", ok: true); app.KeyChanged(); }
        catch (Exception ex) { Say(keyMsg, ex.Message, ok: false); }
        RefreshAll();
    }

    void BuildClients()
    {
        clients.SuspendLayout(); clients.Controls.Clear();
        var cmd = ServerHost.Installed;
        foreach (var c in McpClients.All)
        {
            var st = McpClients.State(c, cmd, roots);
            var buttons = new List<Control>();
            if (st == ClientState.NotConfigured) buttons.Add(Act("Configura", () => Configure(c)));
            if (st == ClientState.Outdated) buttons.Add(Act("Aggiorna", () => Configure(c)));
            if (st is ClientState.Configured or ClientState.Outdated) buttons.Add(Act("Rimuovi", () => Unconfigure(c)));
            string? detail = null;
            if (c.Discover)
            {
                var loc = ClaudeDesktop.Find(roots);
                detail = loc is null ? null : $"File: {loc.File} ({loc.Why})";
                buttons.Add(Act("Scegli file…", ChooseClaudeConfig));
                if (roots.ClaudeConfig is not null) buttons.Add(Act("Automatico", () => { AppSettings.SetClaudeConfig(null); Say(clientMsg, "Claude Desktop: si torna alla ricerca automatica del file.", ok: true); BuildClients(); }));
            }
            clients.Controls.Add(ClientRow(c.Name, Describe(st), buttons, detail));
        }
        clients.Controls.Add(ClientRow("Claude Code", "Si configura dal terminale", [Act("Copia comando", () =>
        {
            Clipboard.SetText(McpClients.ClaudeCodeCommand(cmd));
            Say(clientMsg, "Comando per Claude Code copiato: incollalo nel terminale.", ok: true);
        })]));
        clients.ResumeLayout();
    }

    /// <summary>Per versioni di Claude Desktop che tengono la configurazione altrove: il file è quello che apre Claude con Settings → Desktop app → Extensions → Edit config.</summary>
    void ChooseClaudeConfig()
    {
        using var dlg = new OpenFileDialog { Title = "File di configurazione di Claude Desktop (Edit config)", Filter = "claude_desktop_config.json|claude_desktop_config.json|File JSON|*.json", CheckFileExists = false };
        var cur = ClaudeDesktop.Find(roots)?.File;
        if (cur is not null && Directory.Exists(Path.GetDirectoryName(cur))) dlg.InitialDirectory = Path.GetDirectoryName(cur);
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        AppSettings.SetClaudeConfig(dlg.FileName);
        Say(clientMsg, "Claude Desktop: file scelto a mano. Ora premi Configura.", ok: true);
        BuildClients();
    }

    void Configure(McpClient c)
    {
        try { McpClients.Install(c, ServerHost.Installed, roots); Say(clientMsg, $"{c.Name} configurato: riavvialo per caricare il server.", ok: true); }
        catch (Exception ex) { Say(clientMsg, $"{c.Name}: {ex.Message}", ok: false); }
        BuildClients();
    }

    void Unconfigure(McpClient c)
    {
        try { McpClients.Remove(c, roots, ServerHost.Installed); Say(clientMsg, $"Server tolto da {c.Name}: riavvialo.", ok: true); }
        catch (Exception ex) { Say(clientMsg, $"{c.Name}: {ex.Message}", ok: false); }
        BuildClients();
    }

    static string Describe(ClientState s) => s switch
    {
        ClientState.NotInstalled => "Non installato",
        ClientState.NotConfigured => "Non configurato",
        ClientState.Configured => "Configurato",
        ClientState.Outdated => "Punta a un altro server: da aggiornare",
        _ => "File di configurazione non leggibile (JSON non valido o con commenti): modificalo a mano.",
    };

    // ---------- piccoli costruttori di controlli ----------

    static FlowLayoutPanel Column() => new() { FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink };
    static FlowLayoutPanel Row(params Control[] items) { var r = new FlowLayoutPanel { FlowDirection = FlowDirection.LeftToRight, WrapContents = false, AutoSize = true }; r.Controls.AddRange(items); return r; }
    static Label Lbl(string t) => new() { Text = t, AutoSize = true, MaximumSize = new Size(480, 0) };
    static Label Note(string t) { var l = Lbl(t); l.ForeColor = Color.DimGray; l.Font = new Font("Segoe UI", 8.5f); return l; }
    static Button Act(string t, Action a) { var b = new Button { Text = t, AutoSize = true }; b.Click += (_, _) => a(); return b; }
    static void Say(Label l, string t, bool ok) { l.Text = t; l.ForeColor = ok ? Color.DarkGreen : Color.Firebrick; }

    static GroupBox Group(string title, params Control[] items)
    {
        var inner = Column(); inner.Dock = DockStyle.Fill; inner.Controls.AddRange(items);
        var g = new GroupBox { Text = title, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(10), Margin = new Padding(0, 0, 0, 12), MinimumSize = new Size(500, 0) };
        g.Controls.Add(inner);
        return g;
    }

    static Control ClientRow(string name, string state, List<Control> buttons, string? detail = null)
    {
        var info = Column();
        info.Controls.Add(new Label { Text = name, AutoSize = true, Font = new Font("Segoe UI", 9.5f, FontStyle.Bold) });
        info.Controls.Add(Note(state));
        info.MinimumSize = new Size(280, 0); info.MaximumSize = new Size(280, 0);
        var row = Row(info); foreach (var b in buttons) row.Controls.Add(b);
        row.Margin = new Padding(0, 0, 0, 6);
        if (detail is null) return row;
        // percorso lungo senza spazi: una riga con i puntini, il percorso intero nel suggerimento
        var path = new Label { Text = detail, AutoSize = false, AutoEllipsis = true, Size = new Size(480, 18), ForeColor = Color.DimGray, Font = new Font("Segoe UI", 8.5f) };
        new ToolTip().SetToolTip(path, detail);
        var box = Column(); box.Controls.Add(row); box.Controls.Add(path); box.Margin = new Padding(0, 0, 0, 6);
        return box;
    }
}
