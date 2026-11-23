namespace Jobdossiers.Win;

/// <summary>Benvenuto all'avvio: l'app non ha finestra principale, quindi spiega dove trovarla. Sparisce dopo qualche secondo o al clic.</summary>
sealed class SplashForm : Form
{
    readonly System.Windows.Forms.Timer timer = new() { Interval = 3500 };

    public SplashForm(bool hasKey)
    {
        FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.CenterScreen; ShowInTaskbar = false; TopMost = true;
        BackColor = Color.White; Size = new Size(420, 280); Padding = new Padding(24);
        var version = AppInfo.Version;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 5 };
        layout.Controls.Add(new PictureBox { Image = AppIcon.Large(64), SizeMode = PictureBoxSizeMode.CenterImage, Dock = DockStyle.Fill, Height = 72 });
        layout.Controls.Add(Centered("Jobdossiers", new Font("Segoe UI", 18, FontStyle.Bold), Color.Black));
        layout.Controls.Add(Centered($"Server MCP per le tue candidature · {version}", new Font("Segoe UI", 9.5f), Color.DimGray));
        layout.Controls.Add(Centered("L'icona è nell'area di notifica, in basso a destra", new Font("Segoe UI", 9.5f), Color.Black));
        layout.Controls.Add(Centered(hasKey ? "Chiave presente: il server è pronto per i client MCP." : "Nessuna chiave salvata: aprila da Impostazioni nel menu dell'icona.", new Font("Segoe UI", 8.5f), hasKey ? Color.DimGray : Color.DarkOrange));
        Controls.Add(layout);
        CloseOnClick(this);
        Paint += (_, e) => ControlPaint.DrawBorder(e.Graphics, ClientRectangle, Color.Gainsboro, ButtonBorderStyle.Solid);
        timer.Tick += (_, _) => Close();
        Shown += (_, _) => timer.Start();
        FormClosed += (_, _) => timer.Dispose();
    }

    void CloseOnClick(Control c) { c.Click += (_, _) => Close(); foreach (Control x in c.Controls) CloseOnClick(x); }

    static Label Centered(string text, Font font, Color color) =>
        new() { Text = text, Font = font, ForeColor = color, TextAlign = ContentAlignment.MiddleCenter, Dock = DockStyle.Fill, AutoSize = false, Height = 30 };
}
