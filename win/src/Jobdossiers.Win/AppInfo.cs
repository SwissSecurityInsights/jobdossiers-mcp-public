namespace Jobdossiers.Win;

/// <summary>Versione dell'app (&lt;Version&gt; del progetto, uguale a package.json), mostrata in ogni finestra.</summary>
static class AppInfo
{
    public static string Version => typeof(AppInfo).Assembly.GetName().Version?.ToString(3) ?? "sviluppo";
}
