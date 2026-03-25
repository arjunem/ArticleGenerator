using System.Diagnostics;
using ArtGen.Models;

namespace ArtGen.Services;

public class DirectConversionService(IConfiguration config, ILogger<DirectConversionService> logger)
    : IConversionService
{
    private readonly string _pandoc = config["Conversion:PandocPath"] ?? "pandoc";
    private readonly string _wkhtmltopdf = config["Conversion:WkhtmltopdfPath"] ?? "wkhtmltopdf";

    public async Task<ConversionOutput> ConvertAsync(ConversionRequest request, CancellationToken ct = default)
    {
        var files = new List<OutputFile>();
        var tmpDir = Path.Combine(Path.GetTempPath(), Path.GetRandomFileName());
        Directory.CreateDirectory(tmpDir);

        try
        {
            var mdPath = Path.Combine(tmpDir, "input.md");
            await File.WriteAllTextAsync(mdPath, request.MarkdownContent, ct);

            string? templatePath = null;
            if (!string.IsNullOrEmpty(request.TemplateContent))
            {
                var ext = Path.GetExtension(request.TemplateFilename ?? "template.html");
                templatePath = Path.Combine(tmpDir, $"template{ext}");
                await File.WriteAllTextAsync(templatePath, request.TemplateContent, ct);
            }

            foreach (var format in request.OutputFormats)
            {
                var outputPath = Path.Combine(tmpDir,
                    format == OutputFormat.Html ? "output.html" : "output.pdf");
                await RunPandocAsync(mdPath, outputPath, templatePath, format, ct);
                var bytes = await File.ReadAllBytesAsync(outputPath, ct);
                files.Add(new OutputFile(format, bytes,
                    format == OutputFormat.Html ? "document.html" : "document.pdf"));
            }
        }
        finally
        {
            try { Directory.Delete(tmpDir, true); } catch { /* best-effort cleanup */ }
        }

        return new ConversionOutput(files);
    }

    private async Task RunPandocAsync(string input, string output, string? templatePath,
        OutputFormat format, CancellationToken ct)
    {
        var args = new List<string>
        {
            input, "-o", output,
            "--highlight-style=breezedark",
            "--standalone"
        };

        if (templatePath != null)
        {
            var ext = Path.GetExtension(templatePath).ToLower();
            if (ext == ".css")
                args.AddRange(["--css", templatePath]);
            else if (ext == ".html")
                args.AddRange(["--template", templatePath]);
            // .md and .pdf templates: pass as --include-before-body for .md, skip for .pdf
            else if (ext == ".md")
                args.AddRange(["--include-before-body", templatePath]);
        }

        if (format == OutputFormat.Pdf)
            args.AddRange(["--pdf-engine", _wkhtmltopdf]);

        var psi = new ProcessStartInfo(_pandoc)
        {
            RedirectStandardError = true,
            UseShellExecute = false
        };
        foreach (var a in args) psi.ArgumentList.Add(a);

        using var proc = Process.Start(psi)
            ?? throw new InvalidOperationException("Could not start pandoc");
        var stderr = await proc.StandardError.ReadToEndAsync(ct);
        await proc.WaitForExitAsync(ct);

        if (proc.ExitCode != 0)
        {
            logger.LogError("Pandoc failed: {Error}", stderr);
            throw new InvalidOperationException($"Pandoc conversion failed: {stderr}");
        }
    }
}
