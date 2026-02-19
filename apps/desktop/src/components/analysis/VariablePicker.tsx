import { useState, useMemo } from 'react';

export interface PickerVariable {
  name: string;
  type: 'numeric' | 'string' | 'date';
  label?: string;
}

interface VariablePickerProps {
  variables: PickerVariable[];
  /** Filter to only show variables matching these types; omit to show all */
  acceptedTypes?: ('numeric' | 'string' | 'any')[];
  onDragStart?: (varName: string) => void;
  onSelect?: (varName: string) => void;
  className?: string;
}

const TYPE_COLORS: Record<PickerVariable['type'], string> = {
  numeric: 'bg-blue-400',
  string: 'bg-amber-400',
  date: 'bg-green-400',
};

const TYPE_LABELS: Record<PickerVariable['type'], string> = {
  numeric: 'Scale',
  string: 'String',
  date: 'Date',
};

function variableMatchesAccepted(
  variable: PickerVariable,
  accepted: ('numeric' | 'string' | 'any')[],
): boolean {
  if (accepted.includes('any')) return true;
  return accepted.includes(variable.type as 'numeric' | 'string');
}

export function VariablePicker({
  variables,
  acceptedTypes,
  onDragStart,
  onSelect,
  className = '',
}: VariablePickerProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<PickerVariable['type'] | 'all'>('all');

  const visible = useMemo(() => {
    let list = variables;

    if (acceptedTypes && acceptedTypes.length > 0) {
      list = list.filter(v => variableMatchesAccepted(v, acceptedTypes));
    }

    if (typeFilter !== 'all') {
      list = list.filter(v => v.type === typeFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        v =>
          v.name.toLowerCase().includes(q) ||
          (v.label ?? '').toLowerCase().includes(q),
      );
    }

    return list;
  }, [variables, acceptedTypes, typeFilter, search]);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Search */}
      <div className="px-2 pt-2 pb-1">
        <input
          type="text"
          placeholder="Search variables…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      {/* Type filter tabs */}
      <div className="flex gap-0.5 px-2 pb-1">
        {(['all', 'numeric', 'string', 'date'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`text-xs px-1.5 py-0.5 rounded capitalize ${
              typeFilter === t
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t === 'all' ? 'All' : TYPE_LABELS[t as PickerVariable['type']]}
          </button>
        ))}
      </div>

      {/* Variable list */}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-4">No variables</p>
        )}
        {visible.map(variable => (
          <div
            key={variable.name}
            draggable
            onDragStart={e => {
              e.dataTransfer.setData('text/plain', variable.name);
              onDragStart?.(variable.name);
            }}
            onClick={() => onSelect?.(variable.name)}
            className="flex items-center gap-1.5 px-2 py-1 text-xs cursor-grab hover:bg-blue-50 select-none group"
            title={`${variable.name}${variable.label ? ` — ${variable.label}` : ''} (${TYPE_LABELS[variable.type]})`}
          >
            <span
              className={`w-3 h-3 rounded-sm flex-shrink-0 ${TYPE_COLORS[variable.type]}`}
            />
            <span className="flex-1 truncate text-gray-800">
              {variable.label ?? variable.name}
            </span>
            <span className="text-gray-400 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">
              {variable.name}
            </span>
          </div>
        ))}
      </div>

      {/* Count */}
      <div className="px-2 py-1 text-[10px] text-gray-400 border-t border-gray-100">
        {visible.length} of {variables.length} variable{variables.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
