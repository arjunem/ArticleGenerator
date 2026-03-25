using ArtGen.Models;
using Markdig;
using PuppeteerSharp;
using PuppeteerSharp.Media;

namespace ArtGen.Services;

public class DirectConversionService(ChromiumState chromiumState) : IConversionService
{
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UseAdvancedExtensions()
        .Build();

    public async Task<ConversionOutput> ConvertAsync(ConversionRequest request, CancellationToken ct = default)
    {
        var html = BuildHtml(request);
        var files = new List<OutputFile>();

        foreach (var format in request.OutputFormats)
        {
            if (format == OutputFormat.Html)
            {
                var bytes = System.Text.Encoding.UTF8.GetBytes(html);
                files.Add(new OutputFile(format, bytes, "document.html"));
            }
            else if (format == OutputFormat.Pdf)
            {
                var bytes = await GeneratePdfAsync(html, ct);
                files.Add(new OutputFile(format, bytes, "document.pdf"));
            }
        }

        return new ConversionOutput(files);
    }

    private string BuildHtml(ConversionRequest request)
    {
        var bodyHtml = Markdown.ToHtml(request.MarkdownContent, Pipeline);

        string css = DefaultCss;
        string? customBody = null;

        if (!string.IsNullOrEmpty(request.TemplateContent) && !string.IsNullOrEmpty(request.TemplateFilename))
        {
            var ext = Path.GetExtension(request.TemplateFilename).ToLowerInvariant();
            switch (ext)
            {
                case ".css":
                    css = request.TemplateContent;
                    break;
                case ".html":
                    return request.TemplateContent.Replace("{{{content}}}", bodyHtml);
                case ".md":
                    customBody = Markdown.ToHtml(request.TemplateContent, Pipeline) + bodyHtml;
                    break;
            }
        }

        return WrapInShell(customBody ?? bodyHtml, css);
    }

    private static string WrapInShell(string body, string css) =>
        $"""
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>{css}</style>
        </head>
        <body>
        {body}
        </body>
        </html>
        """;

    private async Task<byte[]> GeneratePdfAsync(string html, CancellationToken ct)
    {
        using var browser = await Puppeteer.LaunchAsync(new LaunchOptions
        {
            ExecutablePath = chromiumState.ExecutablePath,
            Headless = true,
            Args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
        });

        using var page = await browser.NewPageAsync();
        await page.SetContentAsync(html, new NavigationOptions
        {
            WaitUntil = [WaitUntilNavigation.Networkidle0]
        });

        return await page.PdfDataAsync(new PdfOptions
        {
            Format = PaperFormat.A4,
            PrintBackground = true,
            MarginOptions = new MarginOptions
            {
                Top = "20mm", Bottom = "20mm", Left = "15mm", Right = "15mm"
            }
        });
    }

    private const string DefaultCss = """
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            max-width: 860px;
            margin: 2rem auto;
            padding: 0 1rem;
            line-height: 1.6;
            color: #24292e;
        }
        h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; }
        pre {
            background: #1e1e2e;
            color: #cdd6f4;
            padding: 1rem;
            border-radius: 4px;
            overflow-x: auto;
        }
        code {
            font-family: 'Cascadia Code', Consolas, monospace;
            font-size: 0.9em;
        }
        pre code { background: none; padding: 0; }
        code:not(pre code) { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; }
        table { border-collapse: collapse; width: 100%; margin: 1em 0; }
        th, td { border: 1px solid #ddd; padding: 0.5em 0.75em; }
        th { background: #f6f8fa; }
        blockquote { border-left: 4px solid #ddd; margin: 0; padding: 0.5em 1em; color: #666; }
        img { max-width: 100%; }
        """;
}
