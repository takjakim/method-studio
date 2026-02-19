/**
 * VariableTransferList.tsx
 *
 * Jamovi-style variable source list.
 * Renders the LEFT panel of an analysis dialog:
 *  - Searchable, scrollable variable list
 *  - Click-to-select (single item)
 *  - Double-click-to-transfer convenience shortcut
 *  - Arrow transfer button column (→ / ←)
 *
 * Styling comes entirely from jamovi.css via .jv-* classes.
 */

import { useState, useMemo, useCallback } from 'react';
import type { VariableSlot } from '@method-studio/analysis-specs';

/* ------------------------------------------------------------------ */
/* Public types                                                         */
/* ------------------------------------------------------------------ */

export interface TransferVariable {
  name: string;
  type: 'numeric' | 'string' | 'date';
  label?: string;
}

export interface VariableTransferListProps {
  /** Full list of dataset variables */
  variables: TransferVariable[];
  /** Current slot assignments — used to mark variables as "used" */
  slots: Record<string, string[]>;
  /** Slot specs — used to determine the target slot for arrow transfer */
  slotSpecs: VariableSlot[];
  /** The currently "active" (focused) slot id — drives → button behavior */
  activeSlotId: string | null;
  /** Currently selected variable in the source list */
  selectedVar: string | null;
  onSelectVar: (name: string | null) => void;
  /** Transfer a variable to a specific slot */
  onTransferTo: (slotId: string, varName: string) => void;
  /** Remove a variable from its current slot(s) */
  onRemoveVar: (varName: string) => void;
  /** Convenience: double-click transfers to first eligible slot */
  onDoubleClickVar: (varName: string) => void;
}

/* ------------------------------------------------------------------ */
/* Type icon rendering                                                  */
/* ------------------------------------------------------------------ */

const TYPE_SIGIL: Record<TransferVariable['type'], string> = {
  numeric: '#',
  string: 'A',
  date: 'D',
};

function VarIcon({ type }: { type: TransferVariable['type'] }) {
  return (
    <span className={`jv-var-icon jv-var-icon--${type}`} aria-hidden="true">
      {TYPE_SIGIL[type]}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* VariableTransferList                                                  */
/* ------------------------------------------------------------------ */

export function VariableTransferList({
  variables,
  slots,
  slotSpecs,
  activeSlotId,
  selectedVar,
  onSelectVar,
  onTransferTo,
  onRemoveVar,
  onDoubleClickVar,
}: VariableTransferListProps) {
  const [search, setSearch] = useState('');

  /* Build a fast set of all used variable names */
  const usedVars = useMemo(() => {
    const used = new Set<string>();
    for (const arr of Object.values(slots)) {
      for (const v of arr) used.add(v);
    }
    return used;
  }, [slots]);

  /* Filter list by search query */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return variables;
    return variables.filter(
      v =>
        v.name.toLowerCase().includes(q) ||
        (v.label ?? '').toLowerCase().includes(q),
    );
  }, [variables, search]);

  /* ---- Transfer → button logic ---- */
  const canTransferForward = selectedVar !== null && activeSlotId !== null;

  const handleTransferForward = useCallback(() => {
    if (!selectedVar || !activeSlotId) return;
    onTransferTo(activeSlotId, selectedVar);
    onSelectVar(null);
  }, [selectedVar, activeSlotId, onTransferTo, onSelectVar]);

  /* Transfer ← : remove selected var from all slots */
  const canTransferBack = selectedVar !== null && usedVars.has(selectedVar);

  const handleTransferBack = useCallback(() => {
    if (!selectedVar) return;
    onRemoveVar(selectedVar);
    onSelectVar(null);
  }, [selectedVar, onRemoveVar, onSelectVar]);

  /* ---- Item click / double-click ---- */
  const handleItemClick = useCallback(
    (name: string) => {
      onSelectVar(selectedVar === name ? null : name);
    },
    [selectedVar, onSelectVar],
  );

  const handleItemDoubleClick = useCallback(
    (name: string) => {
      onSelectVar(null);
      onDoubleClickVar(name);
    },
    [onSelectVar, onDoubleClickVar],
  );

  /* Find a descriptive label for the → target */
  const targetSlotLabel = activeSlotId
    ? (slotSpecs.find(s => s.id === activeSlotId)?.label ?? activeSlotId)
    : null;

  return (
    <>
      {/* ---- Left: variable source list ---- */}
      <div className="jv-var-panel">
        <div className="jv-var-panel-header">
          <div className="jv-var-panel-title">Variables</div>
          <input
            className="jv-search-input"
            type="text"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search variables"
          />
        </div>

        <div className="jv-var-list" role="listbox" aria-label="Available variables">
          {filtered.length === 0 && (
            <div
              style={{
                padding: '12px 8px',
                textAlign: 'center',
                fontSize: 'var(--jv-font-xs)',
                color: 'var(--jv-text-muted)',
              }}
            >
              No variables
            </div>
          )}
          {filtered.map(v => {
            const isSelected = selectedVar === v.name;
            const isUsed = usedVars.has(v.name);
            return (
              <div
                key={v.name}
                role="option"
                aria-selected={isSelected}
                className={[
                  'jv-var-item',
                  isSelected ? 'is-selected' : '',
                  isUsed && !isSelected ? 'is-used' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => handleItemClick(v.name)}
                onDoubleClick={() => handleItemDoubleClick(v.name)}
                title={
                  v.label
                    ? `${v.name} — ${v.label}`
                    : v.name
                }
              >
                <VarIcon type={v.type} />
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <span className="jv-var-name">{v.name}</span>
                  {v.label && (
                    <span className="jv-var-label">{v.label}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="jv-var-count">
          {filtered.length} of {variables.length}{' '}
          {variables.length === 1 ? 'variable' : 'variables'}
        </div>
      </div>

      {/* ---- Transfer arrow column ---- */}
      <div
        className="jv-transfer-col"
        title={
          targetSlotLabel
            ? `Transfer to: ${targetSlotLabel}`
            : 'Select a slot, then click →'
        }
      >
        <button
          className="jv-transfer-btn"
          onClick={handleTransferForward}
          disabled={!canTransferForward}
          aria-label={
            targetSlotLabel
              ? `Add to ${targetSlotLabel}`
              : 'Add to active slot'
          }
          title={
            canTransferForward
              ? `Add to ${targetSlotLabel ?? 'slot'}`
              : 'Select a variable and activate a slot first'
          }
        >
          &#x203A;
        </button>

        <button
          className="jv-transfer-btn"
          onClick={handleTransferBack}
          disabled={!canTransferBack}
          aria-label="Remove variable from slot"
          title={
            canTransferBack
              ? 'Remove from slot'
              : 'Select a used variable to remove'
          }
        >
          &#x2039;
        </button>
      </div>
    </>
  );
}
