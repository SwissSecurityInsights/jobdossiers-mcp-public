using System.Drawing.Drawing2D;

namespace Jobdossiers.Win;

/// <summary>Icona disegnata nel codice (valigetta), per non dipendere da file .ico nel prototipo.</summary>
static class AppIcon
{
    static readonly Color Accent = Color.FromArgb(0xC8, 0x1E, 0x2D);

    public static Icon Create(int size = 32)
    {
        using var bmp = new Bitmap(size, size);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            float s = size / 32f;
            using var body = Rounded(new RectangleF(3 * s, 10 * s, 26 * s, 18 * s), 3 * s);
            using var brush = new SolidBrush(Accent);
            g.FillPath(brush, body);
            using var pen = new Pen(Accent, 2.5f * s);
            g.DrawArc(pen, 11 * s, 4 * s, 10 * s, 10 * s, 180, 180);
            using var band = new Pen(Color.White, 1.5f * s);
            g.DrawLine(band, 3 * s, 17 * s, 29 * s, 17 * s);
        }
        return Icon.FromHandle(bmp.GetHicon());
    }

    public static Bitmap Large(int size = 72)
    {
        var bmp = new Bitmap(size, size);
        using var g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using var ic = Create(size);
        g.DrawIcon(ic, new Rectangle(0, 0, size, size));
        return bmp;
    }

    static GraphicsPath Rounded(RectangleF r, float rad)
    {
        var p = new GraphicsPath(); float d = rad * 2;
        p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure(); return p;
    }
}
