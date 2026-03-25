namespace ArtGen.Models;

public enum OutputFormat { Html, Pdf }
public enum ConversionEngine { Direct, Llm }

public record ConversionRequest(
    string MarkdownContent,
    string? TemplateContent,
    string? TemplateFilename,
    ConversionEngine Engine,
    string LlmModel,
    IEnumerable<OutputFormat> OutputFormats
);

public record OutputFile(OutputFormat Format, byte[] Content, string Filename);
public record ConversionOutput(IEnumerable<OutputFile> Files);

public record ConversionResultItem(string Format, string DownloadToken, string Filename);
public record ConversionResponse(bool Success, IEnumerable<ConversionResultItem> Outputs);
