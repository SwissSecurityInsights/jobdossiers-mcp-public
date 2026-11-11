namespace Jobdossiers;

/// <summary>Chiave per automazioni jda1.&lt;token&gt;.&lt;segreto&gt;: stessa regola di parseKey in src/crypto.js.</summary>
public static class KeyFormat
{
    public static bool IsValid(string? key)
    {
        var p = (key ?? "").Trim().Split('.');
        return p.Length == 3 && p[0] == "jda1" && IsB64U43(p[1]) && IsB64U43(p[2]);
    }

    static bool IsB64U43(string s) => s.Length == 43 && s.All(c => c is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '_' or '-');
}
