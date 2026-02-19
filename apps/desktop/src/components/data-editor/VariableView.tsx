import { useCallback, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ColDef,
  GridReadyEvent,
  CellValueChangedEvent,
  GridApi,
  SelectionChangedEvent,
} from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { useDataStore } from '../../stores/data-store';
import { Variable } from '../../types/data';

const TYPE_OPTIONS = ['numeric', 'string', 'date'];
const MEASURE_OPTIONS = ['scale', 'ordinal', 'nominal'];

// Select cell editor for type/measure
function createSelectEditor(options: string[]) {
  return class SelectEditor {
    private eInput!: HTMLSelectElement;

    init(params: { value: string }) {
      this.eInput = document.createElement('select');
      this.eInput.style.width = '100%';
      this.eInput.style.height = '100%';
      options.forEach((opt) => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
        if (opt === params.value) option.selected = true;
        this.eInput.appendChild(option);
      });
    }

    getGui() { return this.eInput; }
    getValue() { return this.eInput.value; }
    isPopup() { return false; }

    afterGuiAttached() {
      this.eInput.focus();
    }

    destroy() {}
  };
}

// Values/Missing display - show count of defined labels or missing values
function ValueLabelsRenderer(props: { value: Record<string | number, string> | undefined }) {
  const count = props.value ? Object.keys(props.value).length : 0;
  if (count === 0) return <span className="text-[var(--color-text-muted)] text-xs">None</span>;
  return (
    <span className="text-xs text-[var(--color-accent)] cursor-pointer">
      {count} label{count !== 1 ? 's' : ''}
    </span>
  );
}

function MissingRenderer(props: { value: (string | number)[] | undefined }) {
  const count = props.value?.length ?? 0;
  if (count === 0) return <span className="text-[var(--color-text-muted)] text-xs">None</span>;
  return (
    <span className="text-xs text-[var(--color-warning)] cursor-pointer">
      {count} defined
    </span>
  );
}

type VariableRow = Variable & { _index: number };

export function VariableView() {
  const gridApiRef = useRef<GridApi | null>(null);
  const dataset = useDataStore((s) => s.dataset);
  const addVariable = useDataStore((s) => s.addVariable);
  const updateVariable = useDataStore((s) => s.updateVariable);
  const deleteVariable = useDataStore((s) => s.deleteVariable);
  const setActiveVariable = useDataStore((s) => s.setActiveVariable);
  const activeVariableIndex = useDataStore((s) => s.activeVariableIndex);

  const onGridReady = useCallback((params: GridReadyEvent) => {
    gridApiRef.current = params.api;
  }, []);

  const rowData = useMemo<VariableRow[]>(() => {
    if (!dataset) return [];
    return dataset.variables.map((v, i) => ({ ...v, _index: i }));
  }, [dataset]);

  const columnDefs = useMemo<ColDef[]>(() => [
    {
      headerName: '#',
      colId: '__rowNum',
      valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1,
      width: 44,
      minWidth: 44,
      maxWidth: 44,
      editable: false,
      sortable: false,
      pinned: 'left',
      cellClass: 'spss-var-rownum text-center text-xs text-[var(--color-text-muted)]',
      headerClass: 'spss-var-header',
    },
    {
      headerName: 'Name',
      field: 'name',
      editable: true,
      width: 120,
      minWidth: 80,
      cellClass: 'spss-var-cell font-mono text-xs',
      valueSetter: (params) => {
        // Validate: must be valid identifier
        const name = String(params.newValue).trim();
        if (!name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return false;
        params.data.name = name;
        return true;
      },
    },
    {
      headerName: 'Type',
      field: 'type',
      editable: true,
      width: 90,
      cellEditor: createSelectEditor(TYPE_OPTIONS),
      cellClass: 'spss-var-cell text-xs',
      valueFormatter: (p) => {
        const val = p.value as string;
        return val ? val.charAt(0).toUpperCase() + val.slice(1) : '';
      },
    },
    {
      headerName: 'Width',
      field: 'width',
      editable: true,
      width: 70,
      type: 'numericColumn',
      cellClass: 'spss-var-cell text-xs text-right',
      cellEditor: 'agNumberCellEditor',
      valueSetter: (params) => {
        const w = Number(params.newValue);
        if (isNaN(w) || w < 1 || w > 40) return false;
        params.data.width = w;
        return true;
      },
    },
    {
      headerName: 'Decimals',
      field: 'decimals',
      editable: true,
      width: 80,
      type: 'numericColumn',
      cellClass: 'spss-var-cell text-xs text-right',
      cellEditor: 'agNumberCellEditor',
      valueSetter: (params) => {
        const d = Number(params.newValue);
        if (isNaN(d) || d < 0 || d > 16) return false;
        params.data.decimals = d;
        return true;
      },
    },
    {
      headerName: 'Label',
      field: 'label',
      editable: true,
      width: 150,
      flex: 1,
      cellClass: 'spss-var-cell text-xs',
    },
    {
      headerName: 'Values',
      field: 'values',
      editable: false,
      width: 90,
      cellRenderer: ValueLabelsRenderer,
      cellClass: 'spss-var-cell',
    },
    {
      headerName: 'Missing',
      field: 'missing',
      editable: false,
      width: 90,
      cellRenderer: MissingRenderer,
      cellClass: 'spss-var-cell',
    },
    {
      headerName: 'Measure',
      field: 'measure',
      editable: true,
      width: 95,
      cellEditor: createSelectEditor(MEASURE_OPTIONS),
      cellClass: 'spss-var-cell text-xs',
      valueFormatter: (p) => {
        const val = p.value as string;
        return val ? val.charAt(0).toUpperCase() + val.slice(1) : '';
      },
      cellClassRules: {
        'text-blue-500': (p) => p.value === 'scale',
        'text-green-500': (p) => p.value === 'ordinal',
        'text-orange-500': (p) => p.value === 'nominal',
      },
    },
  ], []);

  const onCellValueChanged = useCallback(
    (event: CellValueChangedEvent) => {
      const row = event.data as VariableRow;
      const { _index, ...variable } = row;
      updateVariable(_index, variable as Variable);
    },
    [updateVariable]
  );

  const onSelectionChanged = useCallback(
    (event: SelectionChangedEvent) => {
      const selected = event.api.getSelectedNodes();
      if (selected.length > 0) {
        const row = selected[0].data as VariableRow;
        setActiveVariable(row._index);
      } else {
        setActiveVariable(null);
      }
    },
    [setActiveVariable]
  );

  const handleAddVariable = useCallback(() => {
    if (!dataset) return;
    const existingNames = new Set(dataset.variables.map((v) => v.name));
    let idx = dataset.variables.length + 1;
    let name = `var${idx}`;
    while (existingNames.has(name)) {
      idx++;
      name = `var${idx}`;
    }
    addVariable({
      name,
      type: 'numeric',
      label: '',
      values: {},
      missing: [],
      width: 8,
      decimals: 2,
      measure: 'scale',
    });
  }, [dataset, addVariable]);

  const handleDeleteVariable = useCallback(() => {
    if (activeVariableIndex === null) return;
    deleteVariable(activeVariableIndex);
  }, [activeVariableIndex, deleteVariable]);

  if (!dataset) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)]">
        No dataset open.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <button
          onClick={handleAddVariable}
          className="spss-toolbar-btn"
          title="Add Variable"
        >
          + Add Variable
        </button>
        <button
          onClick={handleDeleteVariable}
          disabled={activeVariableIndex === null}
          className="spss-toolbar-btn danger"
          title="Delete Selected Variable"
        >
          - Delete Variable
        </button>
        <div className="flex-1" />
        <span className="text-xs text-[var(--color-text-muted)]">
          {dataset.variables.length} variable{dataset.variables.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Grid */}
      <div className="flex-1 ag-theme-alpine spss-var-grid-container">
        <style>{`
          .spss-var-grid-container .ag-header-cell {
            background-color: var(--color-surface-secondary);
            border-right: 1px solid var(--color-border);
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          .spss-var-grid-container .ag-cell {
            border-right: 1px solid var(--color-border-light);
            font-size: 12px;
            line-height: 26px;
          }
          .spss-var-grid-container .ag-row-selected {
            background-color: var(--color-selection) !important;
          }
          .spss-var-grid-container .ag-row:hover {
            background-color: var(--color-surface-hover);
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
          .spss-toolbar-btn.danger:hover:not(:disabled) {
            background: var(--color-danger-surface);
            border-color: var(--color-danger);
            color: var(--color-danger);
          }
        `}</style>
        <AgGridReact
          columnDefs={columnDefs}
          rowData={rowData}
          onGridReady={onGridReady}
          onCellValueChanged={onCellValueChanged}
          onSelectionChanged={onSelectionChanged}
          rowSelection="single"
          rowHeight={26}
          headerHeight={30}
          stopEditingWhenCellsLoseFocus
          singleClickEdit
          animateRows={false}
          defaultColDef={{
            resizable: true,
          }}
        />
      </div>

      {/* Help hint */}
      <div className="px-3 py-1 text-xs text-[var(--color-text-muted)] border-t border-[var(--color-border)] bg-[var(--color-surface)]">
        Click a cell to edit. Name must start with a letter or underscore (e.g. var1, age_group).
      </div>
    </div>
  );
}
