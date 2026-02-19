import { useCallback, useRef, useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ColDef,
  GridReadyEvent,
  CellValueChangedEvent,
  GetContextMenuItemsParams,
  MenuItemDef,
  ValueFormatterParams,
  CellClassParams,
  GridApi,
  RowNode,
} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useDataStore } from '../../stores/data-store';
import { Variable } from '../../types/data';

// Row number cell renderer
function RowNumberRenderer(props: { node: RowNode }) {
  return (
    <span className="text-[var(--color-text-muted)] text-xs select-none">
      {(props.node.rowIndex ?? 0) + 1}
    </span>
  );
}

function formatCellValue(value: unknown, variable: Variable): string {
  if (value === null || value === undefined || value === '') return '';

  // Apply value labels if available
  if (variable.values && variable.values[value as string | number]) {
    return variable.values[value as string | number];
  }

  if (variable.type === 'numeric') {
    const num = Number(value);
    if (isNaN(num)) return String(value);
    return num.toFixed(variable.decimals);
  }

  if (variable.type === 'date') {
    try {
      return new Date(value as string).toLocaleDateString();
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function isMissingValue(value: unknown, variable: Variable): boolean {
  if (!variable.missing || variable.missing.length === 0) return false;
  return variable.missing.includes(value as string | number);
}

export function DataView() {
  const gridApiRef = useRef<GridApi | null>(null);
  const dataset = useDataStore((s) => s.dataset);
  const setCell = useDataStore((s) => s.setCell);
  const addRow = useDataStore((s) => s.addRow);
  const deleteRow = useDataStore((s) => s.deleteRow);
  const undo = useDataStore((s) => s.undo);
  const redo = useDataStore((s) => s.redo);
  const canUndo = useDataStore((s) => s.canUndo);
  const canRedo = useDataStore((s) => s.canRedo);

  const onGridReady = useCallback((params: GridReadyEvent) => {
    gridApiRef.current = params.api;
  }, []);

  const columnDefs = useMemo<ColDef[]>(() => {
    if (!dataset) return [];

    const rowNumberCol: ColDef = {
      headerName: '',
      colId: '__rowNumber',
      width: 50,
      minWidth: 50,
      maxWidth: 50,
      pinned: 'left',
      lockPosition: true,
      suppressMovable: true,
      sortable: false,
      filter: false,
      editable: false,
      resizable: false,
      cellRenderer: RowNumberRenderer,
      cellClass: 'spss-row-number-cell',
      headerClass: 'spss-row-number-header',
    };

    const varCols: ColDef[] = dataset.variables.map((variable) => ({
      headerName: variable.label ? `${variable.name}\n${variable.label}` : variable.name,
      field: variable.name,
      editable: true,
      resizable: true,
      sortable: true,
      filter: true,
      width: Math.max(variable.width * 10, 80),
      minWidth: 60,
      headerTooltip: variable.label || variable.name,
      type: variable.type === 'numeric' ? 'numericColumn' : undefined,
      valueFormatter: (params: ValueFormatterParams) =>
        formatCellValue(params.value, variable),
      cellClass: (params: CellClassParams) => {
        const classes = ['spss-data-cell'];
        if (variable.type === 'numeric') classes.push('text-right');
        if (variable.type === 'string') classes.push('text-left');
        if (isMissingValue(params.value, variable)) classes.push('spss-missing-cell');
        return classes.join(' ');
      },
      headerClass: `spss-col-header spss-col-header-${variable.measure}`,
      cellEditor:
        variable.type === 'numeric' ? 'agNumberCellEditor' : 'agTextCellEditor',
      valueSetter: (params) => {
        let val: unknown = params.newValue;
        if (variable.type === 'numeric') {
          val = params.newValue === '' || params.newValue === null
            ? null
            : Number(params.newValue);
          if (isNaN(val as number)) val = null;
        }
        params.data[variable.name] = val;
        return true;
      },
    }));

    return [rowNumberCol, ...varCols];
  }, [dataset]);

  const rowData = useMemo(() => {
    return dataset?.data ?? [];
  }, [dataset]);

  const onCellValueChanged = useCallback(
    (event: CellValueChangedEvent) => {
      if (!dataset) return;
      const rowIndex = event.node.rowIndex ?? 0;
      const colId = event.column.getColId();
      setCell(rowIndex, colId, event.newValue);
    },
    [dataset, setCell]
  );

  const getContextMenuItems = useCallback(
    (params: GetContextMenuItemsParams): (MenuItemDef | string)[] => {
      const rowIndex = params.node?.rowIndex ?? -1;
      return [
        {
          name: 'Insert Row Above',
          action: () => {
            // For simplicity, add at end; full insert-above would need refactor
            addRow();
          },
          icon: '<span>+</span>',
        },
        {
          name: 'Delete Row',
          disabled: rowIndex < 0,
          action: () => {
            if (rowIndex >= 0) deleteRow(rowIndex);
          },
          icon: '<span>-</span>',
        },
        'separator',
        {
          name: 'Copy',
          action: () => params.api.copyToClipboard(),
          shortcut: 'Ctrl+C',
        },
        {
          name: 'Paste',
          action: () => params.api.pasteFromClipboard(),
          shortcut: 'Ctrl+V',
        },
        'separator',
        {
          name: 'Undo',
          disabled: !canUndo(),
          action: undo,
          shortcut: 'Ctrl+Z',
        },
        {
          name: 'Redo',
          disabled: !canRedo(),
          action: redo,
          shortcut: 'Ctrl+Y',
        },
      ];
    },
    [addRow, deleteRow, undo, redo, canUndo, canRedo]
  );

  if (!dataset) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)]">
        <div className="text-center">
          <div className="text-4xl mb-4">No Data</div>
          <p className="text-sm">Open a dataset or create a new one to get started.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <button
          onClick={addRow}
          className="spss-toolbar-btn"
          title="Add Row"
        >
          Add Row
        </button>
        <div className="w-px h-4 bg-[var(--color-border)]" />
        <button
          onClick={undo}
          disabled={!canUndo()}
          className="spss-toolbar-btn"
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          onClick={redo}
          disabled={!canRedo()}
          className="spss-toolbar-btn"
          title="Redo (Ctrl+Y)"
        >
          Redo
        </button>
        <div className="flex-1" />
        <span className="text-xs text-[var(--color-text-muted)]">
          {dataset.data.length} rows &times; {dataset.variables.length} variables
        </span>
      </div>

      {/* Grid */}
      <div className="flex-1 ag-theme-alpine spss-grid-container">
        <style>{`
          .spss-grid-container .ag-header-cell {
            background-color: var(--color-surface-secondary);
            border-right: 1px solid var(--color-border);
            font-size: 12px;
            font-weight: 600;
          }
          .spss-grid-container .ag-row-even {
            background-color: var(--color-surface);
          }
          .spss-grid-container .ag-row-odd {
            background-color: var(--color-surface-alt);
          }
          .spss-grid-container .ag-row:hover {
            background-color: var(--color-surface-hover);
          }
          .spss-grid-container .ag-cell {
            border-right: 1px solid var(--color-border-light);
            font-size: 12px;
            line-height: 24px;
          }
          .spss-row-number-cell {
            background-color: var(--color-surface-secondary) !important;
            border-right: 2px solid var(--color-border) !important;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .spss-row-number-header {
            background-color: var(--color-surface-secondary) !important;
          }
          .spss-missing-cell {
            color: var(--color-missing) !important;
          }
          .spss-col-header-scale::after {
            content: ' \\2248';
            opacity: 0.5;
            font-size: 10px;
          }
          .spss-col-header-ordinal::after {
            content: ' \\2261';
            opacity: 0.5;
            font-size: 10px;
          }
          .spss-col-header-nominal::after {
            content: ' \\25CF';
            opacity: 0.5;
            font-size: 8px;
          }
          .spss-toolbar-btn {
            padding: 2px 8px;
            font-size: 11px;
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            border-radius: 3px;
            cursor: pointer;
            color: var(--color-text);
          }
          .spss-toolbar-btn:hover:not(:disabled) {
            background: var(--color-surface-hover);
          }
          .spss-toolbar-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
          }
        `}</style>
        <AgGridReact
          columnDefs={columnDefs}
          rowData={rowData}
          onGridReady={onGridReady}
          onCellValueChanged={onCellValueChanged}
          getContextMenuItems={getContextMenuItems}
          rowSelection="multiple"
          enableRangeSelection
          stopEditingWhenCellsLoseFocus
          undoRedoCellEditing={false}
          rowHeight={24}
          headerHeight={32}
          defaultColDef={{
            resizable: true,
            sortable: true,
            editable: true,
          }}
          suppressRowClickSelection
          animateRows={false}
        />
      </div>

    </div>
  );
}
