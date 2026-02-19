import { useState } from 'react';
import type { PlotOutput } from '@method-studio/output-renderer';

interface OutputPlotProps {
  plot: PlotOutput;
}

/**
 * Renders a plot produced by the analysis engine.
 * The engine returns base64-encoded PNG data URIs.
 *
 * Features:
 * - Click to expand in a lightbox
 * - Title above the image
 * - Download button
 */
export function OutputPlot({ plot }: OutputPlotProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = plot.imageDataUri;
    link.download = `${plot.title ?? 'plot'}.png`;
    link.click();
  };

  return (
    <div className="my-3">
      {plot.title && (
        <p className="text-xs italic text-gray-800 mb-1 font-medium">{plot.title}</p>
      )}

      <div className="relative inline-block group border border-gray-200 rounded overflow-hidden">
        <img
          src={plot.imageDataUri}
          alt={plot.altText ?? plot.title ?? 'Analysis plot'}
          width={plot.width ?? 480}
          height={plot.height ?? 320}
          className="block cursor-zoom-in"
          onClick={() => setLightboxOpen(true)}
        />

        {/* Hover overlay with download */}
        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
          <button
            onClick={handleDownload}
            className="bg-white/90 border border-gray-300 rounded px-1.5 py-0.5 text-[11px] text-gray-700 hover:bg-gray-100 shadow-sm"
            title="Download PNG"
          >
            Download
          </button>
          <button
            onClick={() => setLightboxOpen(true)}
            className="bg-white/90 border border-gray-300 rounded px-1.5 py-0.5 text-[11px] text-gray-700 hover:bg-gray-100 shadow-sm"
            title="View full size"
          >
            Expand
          </button>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center"
          onClick={() => setLightboxOpen(false)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setLightboxOpen(false)}
              className="absolute -top-8 right-0 text-white text-xl font-light hover:text-gray-300"
              aria-label="Close"
            >
              &times; Close
            </button>
            <img
              src={plot.imageDataUri}
              alt={plot.altText ?? plot.title ?? 'Analysis plot'}
              className="max-w-full max-h-[85vh] object-contain rounded shadow-2xl"
            />
            {plot.title && (
              <p className="text-center text-white text-xs mt-2 italic">{plot.title}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
