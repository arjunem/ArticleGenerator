using ArtGen.Models;

namespace ArtGen.Services;

public interface IConversionService
{
    Task<ConversionOutput> ConvertAsync(ConversionRequest request, CancellationToken ct = default);
}
