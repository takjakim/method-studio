import type { TypedOutputBlock, TableOutput, PlotOutput, ProcessDiagramOutput } from '../../stores/output-store';
import { ProcessDiagram } from './ProcessDiagram';

export interface BlockOutputViewerProps {
  blocks: TypedOutputBlock[];
  showLabels?: boolean;
  variableLabels?: Record<string, string>;
}

// Helper function to replace variable names with labels in text
function replaceWithLabels(text: string, labels: Record<string, string>): string {
  let result = text;
  // Sort by length (longest first) to avoid partial replacements
  const sortedNames = Object.keys(labels).sort((a, b) => b.length - a.length);
  for (const name of sortedNames) {
    const label = labels[name];
    if (label) {
      // Replace whole word matches only
      const regex = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      result = result.replace(regex, label);
    }
  }
  return result;
}

function TitleBlockView({ block }: { block: Extract<TypedOutputBlock, { type: 'title' | 'subtitle' }> }) {
  if (block.type === 'title') {
    return (
      <h2 className="text-sm font-bold text-gray-900 mt-6 mb-1 border-b border-gray-300 pb-1">
        {block.content as string}
      </h2>
    );
  }
  return (
    <h3 className="text-xs font-semibold text-gray-800 mt-4 mb-1 italic">
      {block.content as string}
    </h3>
  );
}

function TableBlockView({
  block,
  showLabels,
  variableLabels,
}: {
  block: Extract<TypedOutputBlock, { type: 'table' }>;
  showLabels?: boolean;
  variableLabels?: Record<string, string>;
}) {
  const table = block.content as TableOutput;

  // Helper to get display text (label or original)
  const getDisplayText = (text: string | number | null | undefined): string => {
    if (text == null) return '';
    const str = String(text);
    if (showLabels && variableLabels) {
      return replaceWithLabels(str, variableLabels);
    }
    return str;
  };

  return (
    <div className="my-3">
      {table.title && (
        <p className="text-xs italic text-gray-800 mb-1 font-medium">
          {getDisplayText(table.title)}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-t-2 border-t-gray-700 border-b border-b-gray-400">
              {table.headers.map((h, i) => (
                <th
                  key={i}
                  className="py-1 px-2 font-semibold text-gray-800 bg-white text-right first:text-left"
                >
                  {getDisplayText(h)}
                </th>
              ))}
            </tr>
            {table.subHeaders && (
              <tr className="border-b border-b-gray-300">
                {table.subHeaders.map((h, i) => (
                  <th
                    key={i}
                    className="py-0.5 px-2 font-medium text-gray-600 bg-white text-right first:text-left text-[11px]"
                  >
                    {getDisplayText(h)}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {table.rows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="py-0.5 px-2 text-gray-800 text-right first:text-left tabular-nums"
                  >
                    {/* Only apply labels to first column (usually variable names) */}
                    {ci === 0 ? getDisplayText(cell) : (cell ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {table.footnotes && table.footnotes.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={table.headers.length} className="pt-1 text-[10px] text-gray-500 italic">
                  {table.footnotes.map((f, i) => (
                    <div key={i}>{getDisplayText(f)}</div>
                  ))}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function PlotBlockView({ block }: { block: Extract<TypedOutputBlock, { type: 'plot' }> }) {
  const plot = block.content as PlotOutput;
  return (
    <div className="my-3">
      {plot.title && (
        <p className="text-xs italic text-gray-800 mb-1 font-medium">{plot.title}</p>
      )}
      <div className="border border-gray-200 rounded overflow-hidden inline-block">
        <img
          src={plot.imageDataUri}
          alt={plot.altText ?? 'Plot'}
          style={{ maxWidth: plot.width ?? 480 }}
          className="block max-w-full"
        />
      </div>
    </div>
  );
}

function TextBlockView({ block }: { block: Extract<TypedOutputBlock, { type: 'text' | 'note' }> }) {
  return (
    <pre className="text-[11px] bg-gray-50 border border-gray-200 rounded p-3 my-3 overflow-x-auto text-gray-700 leading-relaxed whitespace-pre-wrap break-words font-mono">
      {block.content as string}
    </pre>
  );
}

function WarningBlockView({ block }: { block: Extract<TypedOutputBlock, { type: 'warning' | 'error' }> }) {
  const isError = block.type === 'error';
  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 my-3 rounded-r border-l-4 ${
        isError
          ? 'bg-red-50 border-red-500'
          : 'bg-yellow-50 border-yellow-400'
      }`}
    >
      <span
        className={`font-bold text-xs mt-0.5 flex-shrink-0 ${
          isError ? 'text-red-600' : 'text-yellow-700'
        }`}
      >
        {isError ? 'Error' : 'Warning'}
      </span>
      <p className={`text-xs break-words ${isError ? 'text-red-800' : 'text-yellow-800'}`}>
        {block.content as string}
      </p>
    </div>
  );
}

function ProcessDiagramBlockView({ block }: { block: Extract<TypedOutputBlock, { type: 'process-diagram' }> }) {
  const diagram = block.content as ProcessDiagramOutput;
  return (
    <div className="my-4">
      <ProcessDiagram
        modelType={diagram.modelType}
        variables={diagram.variables}
        coefficients={diagram.coefficients}
        pValues={diagram.pValues}
        confidence={diagram.confidence}
      />
    </div>
  );
}

export function BlockOutputViewer({ blocks, showLabels, variableLabels }: BlockOutputViewerProps) {
  if (blocks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[120px] text-gray-400 select-none">
        <svg
          className="w-10 h-10 mb-2 opacity-30"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 17v-6h6v6M3 21h18M3 10l9-7 9 7"
          />
        </svg>
        <p className="text-xs">No output yet. Run an analysis to see results here.</p>
      </div>
    );
  }

  return (
    <div className="px-6 py-4 bg-white font-serif text-sm overflow-y-auto h-full">
      {blocks.map((block) => {
        switch (block.type) {
          case 'title':
          case 'subtitle':
            return <TitleBlockView key={block.id} block={block} />;
          case 'table':
            return (
              <TableBlockView
                key={block.id}
                block={block}
                showLabels={showLabels}
                variableLabels={variableLabels}
              />
            );
          case 'plot':
            return <PlotBlockView key={block.id} block={block} />;
          case 'text':
          case 'note':
            return <TextBlockView key={block.id} block={block} />;
          case 'warning':
          case 'error':
            return <WarningBlockView key={block.id} block={block} />;
          case 'process-diagram':
            return <ProcessDiagramBlockView key={block.id} block={block} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
