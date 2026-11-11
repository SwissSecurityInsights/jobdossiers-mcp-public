using System.Text.Json.Nodes;

namespace Jobdossiers;

/// <summary>Risultato di `jobdossiers-mcp --check` (sola lettura: conteggi, mai valori).</summary>
public sealed record CheckResult(int Applications, int Unreadable, IReadOnlyList<(string Status, int Count)> ByStatus, string? Quota)
{
    /// <summary>Ordine e nomi come lo schema Status di openapi.json; hr_interview e tech_interview sono i nomi precedenti a interview (28.10.2026).</summary>
    public static readonly (string Status, string Label)[] Labels =
    [
        ("preparing", "In preparazione"), ("to_send", "Da inviare"), ("sent", "Inviate"),
        ("in_review", "In valutazione"), ("interview", "Colloquio"), ("hr_interview", "Colloquio HR"), ("tech_interview", "Colloquio tecnico"),
        ("offer", "Offerta"), ("rejected", "Rifiutate"), ("withdrawn", "Ritirate"),
        ("no_answer", "Nessuna risposta"), ("deleted", "Cancellate"),
    ];

    public static string Label(string status) => Labels.FirstOrDefault(l => l.Status == status).Label ?? status;

    /// <summary>null se l'output non è quello atteso.</summary>
    public static CheckResult? Parse(string json)
    {
        JsonObject? j;
        try { j = JsonNode.Parse(json) as JsonObject; } catch (Exception) { return null; }
        if (j is null || j["ok"]?.GetValue<bool>() != true) return null;
        var counts = new Dictionary<string, int>();
        if (j["by_status"] is JsonObject bs) foreach (var (k, v) in bs) if (v is JsonValue n && n.TryGetValue<int>(out var c)) counts[k] = c;
        var known = Labels.Select(l => l.Status).ToHashSet();
        var ordered = Labels.Where(l => counts.ContainsKey(l.Status)).Select(l => (l.Status, counts[l.Status]))
            .Concat(counts.Where(kv => !known.Contains(kv.Key)).OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => (kv.Key, kv.Value))).ToList();
        var q = j["quota"];
        return new CheckResult(j["applications"]?.GetValue<int>() ?? 0, j["unreadable"]?.GetValue<int>() ?? 0, ordered, q is null ? null : q.ToJsonString());
    }
}
