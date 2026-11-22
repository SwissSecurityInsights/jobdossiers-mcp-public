namespace Jobdossiers.Win;

/// <summary>Icona dell'app: il logo JD del portale (assets/icon.svg), incorporato come app.ico (16–256 px). È anche l'icona dell'exe.</summary>
static class AppIcon
{
    static Stream Resource() =>
        typeof(AppIcon).Assembly.GetManifestResourceStream("Jobdossiers.Win.app.ico") ?? throw new InvalidOperationException("app.ico non incorporata");

    /// <summary>Icona alla dimensione più vicina tra quelle del file (area di notifica, finestre).</summary>
    public static Icon Create(int size = 32)
    {
        using var s = Resource();
        return new Icon(s, size, size);
    }

    public static Bitmap Large(int size = 72)
    {
        using var ic = Create(size >= 64 ? 256 : size);
        return new Bitmap(ic.ToBitmap(), size, size);
    }
}
