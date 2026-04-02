using System.Text;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using HtmlAgilityPack;
using UglyToad.PdfPig;

namespace ArtGen.Services;

public interface IInputParserService
{
    Task<string> ParseToMarkdownAsync(IFormFile file, CancellationToken ct);
}

/// <summary>
/// Converts uploaded input files to plain Markdown text.
///
/// Supported types:
///   .md   — returned as-is
///   .txt  — returned as-is
///   .html — structure-aware conversion (headings, paragraphs, lists, code blocks)
///   .json — wrapped in a fenced code block
///   .docx — paragraphs + heading styles mapped to # markers
///   .pdf  — text extracted page by page
/// </summary>
public class InputParserService : IInputParserService
{
    private static readonly HashSet<string> SupportedExtensions =
        [".md", ".txt", ".html", ".htm", ".json", ".docx", ".pdf"];

    public async Task<string> ParseToMarkdownAsync(IFormFile file, CancellationToken ct)
    {
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();

        if (!SupportedExtensions.Contains(ext))
            throw new NotSupportedException(
                $"'{ext}' is not supported. Accepted: {string.Join(", ", SupportedExtensions)}");

        return ext switch
        {
            ".md" or ".txt"    => await ReadAsTextAsync(file, ct),
            ".html" or ".htm"  => await ParseHtmlAsync(file, ct),
            ".json"            => await ParseJsonAsync(file, ct),
            ".docx"            => ParseDocx(file),
            ".pdf"             => ParsePdf(file),
            _                  => await ReadAsTextAsync(file, ct)
        };
    }

    // ── Plain text ────────────────────────────────────────────────────────────

    private static async Task<string> ReadAsTextAsync(IFormFile file, CancellationToken ct)
    {
        using var reader = new StreamReader(file.OpenReadStream(), Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        return await reader.ReadToEndAsync(ct);
    }

    // ── HTML → Markdown ───────────────────────────────────────────────────────

    private static async Task<string> ParseHtmlAsync(IFormFile file, CancellationToken ct)
    {
        var html = await ReadAsTextAsync(file, ct);
        return ParseHtmlString(html);
    }

    public static string ParseHtmlString(string html)
    {
        var doc = new HtmlDocument();
        doc.LoadHtml(html);

        // Start from <body> if present, otherwise the whole document
        var root = doc.DocumentNode.SelectSingleNode("//body") ?? doc.DocumentNode;
        var sb = new StringBuilder();
        WalkHtmlNode(root, sb);
        return sb.ToString().Trim();
    }

    private static void WalkHtmlNode(HtmlNode node, StringBuilder sb)
    {
        switch (node.Name.ToLowerInvariant())
        {
            case "script":
            case "style":
            case "head":
                return;   // skip entirely

            case "h1": sb.AppendLine($"# {HtmlEntity.DeEntitize(node.InnerText).Trim()}").AppendLine(); return;
            case "h2": sb.AppendLine($"## {HtmlEntity.DeEntitize(node.InnerText).Trim()}").AppendLine(); return;
            case "h3": sb.AppendLine($"### {HtmlEntity.DeEntitize(node.InnerText).Trim()}").AppendLine(); return;
            case "h4": sb.AppendLine($"#### {HtmlEntity.DeEntitize(node.InnerText).Trim()}").AppendLine(); return;
            case "h5": sb.AppendLine($"##### {HtmlEntity.DeEntitize(node.InnerText).Trim()}").AppendLine(); return;
            case "h6": sb.AppendLine($"###### {HtmlEntity.DeEntitize(node.InnerText).Trim()}").AppendLine(); return;

            case "p":
                var pText = HtmlEntity.DeEntitize(node.InnerText).Trim();
                if (!string.IsNullOrEmpty(pText)) sb.AppendLine(pText).AppendLine();
                return;

            case "li":
                sb.AppendLine($"- {HtmlEntity.DeEntitize(node.InnerText).Trim()}");
                return;

            case "pre":
            case "code":
                sb.AppendLine($"```\n{HtmlEntity.DeEntitize(node.InnerText)}\n```").AppendLine();
                return;

            case "blockquote":
                sb.AppendLine($"> {HtmlEntity.DeEntitize(node.InnerText).Trim()}").AppendLine();
                return;

            case "br":
                sb.AppendLine();
                return;

            case "hr":
                sb.AppendLine("---").AppendLine();
                return;

            case "#text":
                var text = HtmlEntity.DeEntitize(node.InnerText).Trim();
                if (!string.IsNullOrEmpty(text)) sb.Append(text);
                return;

            default:
                foreach (var child in node.ChildNodes)
                    WalkHtmlNode(child, sb);
                break;
        }
    }

    // ── JSON → fenced code block ──────────────────────────────────────────────

    private static async Task<string> ParseJsonAsync(IFormFile file, CancellationToken ct)
    {
        var json = await ReadAsTextAsync(file, ct);
        return $"```json\n{json.Trim()}\n```";
    }

    // ── DOCX → Markdown ───────────────────────────────────────────────────────

    private static string ParseDocx(IFormFile file)
    {
        using var stream = file.OpenReadStream();
        using var doc = WordprocessingDocument.Open(stream, isEditable: false);

        var body = doc.MainDocumentPart?.Document?.Body;
        if (body is null) return string.Empty;

        var sb = new StringBuilder();

        foreach (var para in body.Elements<Paragraph>())
        {
            var styleId = para.ParagraphProperties?.ParagraphStyleId?.Val?.Value ?? "";
            // Normalise: "Heading1", "Heading 1", "heading1" → "heading1"
            var normStyle = styleId.Replace(" ", "").ToLowerInvariant();

            var text = string.Concat(para.Descendants<Text>().Select(t => t.Text));

            if (string.IsNullOrWhiteSpace(text))
            {
                sb.AppendLine();
                continue;
            }

            if (normStyle.StartsWith("heading") &&
                int.TryParse(normStyle["heading".Length..], out var level) &&
                level is >= 1 and <= 6)
            {
                sb.AppendLine($"{new string('#', level)} {text}");
            }
            else
            {
                sb.AppendLine(text);
            }

            sb.AppendLine();
        }

        return sb.ToString().Trim();
    }

    // ── PDF → plain text ──────────────────────────────────────────────────────

    private static string ParsePdf(IFormFile file)
    {
        using var stream = file.OpenReadStream();
        using var pdf = PdfDocument.Open(stream);

        var sb = new StringBuilder();
        foreach (var page in pdf.GetPages())
        {
            var pageText = page.Text.Trim();
            if (!string.IsNullOrEmpty(pageText))
                sb.AppendLine(pageText).AppendLine();
        }

        return sb.ToString().Trim();
    }
}
