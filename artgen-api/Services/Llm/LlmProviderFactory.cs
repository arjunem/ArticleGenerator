namespace ArtGen.Services.Llm;

public interface ILlmProviderFactory
{
    ILlmProvider Get(string providerName);
}

/// <summary>
/// Resolves the correct ILlmProvider by name.
/// All registered ILlmProvider implementations are injected automatically;
/// adding a new provider only requires DI registration in Program.cs.
/// </summary>
public class LlmProviderFactory(IEnumerable<ILlmProvider> providers) : ILlmProviderFactory
{
    private readonly Dictionary<string, ILlmProvider> _providers =
        providers.ToDictionary(p => p.ProviderName, StringComparer.OrdinalIgnoreCase);

    public ILlmProvider Get(string providerName)
    {
        if (_providers.TryGetValue(providerName, out var provider))
            return provider;

        var available = string.Join(", ", _providers.Keys);
        throw new InvalidOperationException(
            $"LLM provider '{providerName}' is not registered. Available: {available}");
    }
}
