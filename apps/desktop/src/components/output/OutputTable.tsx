import type { TableOutput } from '@method-studio/output-renderer';
import { formatCell } from '@method-studio/output-renderer';

interface OutputTableProps {
  table: TableOutput;
}

/**
 * SPSS-style statistical table.
 *
 * Features:
 * - Title row in italics (APA style)
 * - Double top border / single bottom border
 * - Right-aligned numeric cells
 * - Footnote row below the last rule
 * - Alternating row shading for readability
 */
export function OutputTable({ table }: OutputTableProps) {
  const { title, headers, subHeaders, rows, footnotes, columnAlignment } = table;

  const getAlignment = (colIndex: number): string => {
    if (columnAlignment?.[colIndex]) {
      return columnAlignment[colIndex] === 'left'
        ? 'text-left'
        : columnAlignment[colIndex] === 'center'
        ? 'text-center'
        : 'text-right';
    }
    // First column is usually the variable name (left); rest are numeric (right)
    return colIndex === 0 ? 'text-left' : 'text-right';
  };

  return (
    <div className="my-3">
      {title && (
        <p className="text-xs italic text-gray-800 mb-1 font-medium">{title}</p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          {/* Double top border via two thin lines */}
          <thead>
            <tr className="border-t-2 border-t-gray-700 border-b border-b-gray-400">
              {headers.map((h, i) => (
                <th
                  key={i}
                  className={`py-1 px-2 font-semibold text-gray-800 bg-white ${getAlignment(i)}`}
                >
                  {h}
                </th>
              ))}
            </tr>
            {subHeaders && (
              <tr className="border-b border-b-gray-300">
                {subHeaders.map((h, i) => (
                  <th
                    key={i}
                    className={`py-0.5 px-2 text-[11px] font-medium text-gray-600 bg-gray-50 ${getAlignment(i)}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            )}
          </thead>

          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`py-0.5 px-2 text-gray-800 ${getAlignment(ci)} ${
                      ci === 0 ? 'font-medium' : ''
                    }`}
                  >
                    {cell === null ? '\u2014' : typeof cell === 'number' ? formatCell(cell, 3) : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>

          {/* Single bottom border */}
          <tfoot>
            <tr className="border-t border-t-gray-600">
              <td colSpan={headers.length} className="pt-0.5" />
            </tr>
            {footnotes?.map((fn, i) => (
              <tr key={i}>
                <td
                  colSpan={headers.length}
                  className="px-2 pb-1 text-[11px] text-gray-600 italic"
                >
                  {fn}
                </td>
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
