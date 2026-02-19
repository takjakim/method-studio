/**
 * DraggableVariableList.tsx
 *
 * Drag-enabled variable source list for JamoviStyleDialog.
 *
 * Uses @dnd-kit/core useDraggable to make every variable row draggable.
 * The existing click/double-click/keyboard interaction model from
 * VariableTransferList is preserved as the accessibility fallback.
 *
 * Multi-select behaviour:
 *  - Single click      → select only that variable (clears others)
 *  - Ctrl/Cmd + Click  → toggle that variable in/out of selection
 *  - Shift + Click     → extend range from last-clicked to current
 *  - Drag selected     → drags ALL selected variables as one unit
 *
 * Each draggable item carries a DragData payload so the parent
 * DndContext can identify the source on DragEnd:
 *   { kind: 'variable', varNames: string[], varType: ... }
 *
 * Styling: jamovi.css (.jv-var-item.is-dragging, .jv-drag-ghost, etc.)
 */

import { useState, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { VariableSlot } from '@method-studio/analysis-specs';
import type { TransferVariable } from './VariableTransferList';

/* ------------------------------------------------------------------ */
/* Public drag-data contract (shared with DroppableSlot / Dialog)       */
/* ------------------------------------------------------------------ */

export interface VariableDragData {
  kind: 'variable';
  /** All variable names being dragged in this gesture. */
  varNames: string[];
  /** Type of the primary (clicked) variable — used for the ghost icon. */
  varType: TransferVariable['type'];
}

/* ------------------------------------------------------------------ */
/* Type icon                                                             */
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
/* Single draggable variable row                                         */
/* ------------------------------------------------------------------ */

interface DraggableVarItemProps {
  variable: TransferVariable;
  isSelected: boolean;
  isUsed: boolean;
  isDragSource: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}

function DraggableVarItem({
  variable,
  isSelected,
  isUsed,
  isDragSource,
  onClick,
  onDoubleClick,
}: DraggableVarItemProps) {
  const dragData: VariableDragData = {
    kind: 'variable',
    /* varNames are filled in by the parent at drag-start time via
       the data override mechanism — this row's name is the placeholder. */
    varNames: [variable.name],
    varType: variable.type,
  };

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `var-${variable.name}`,
      data: dragData,
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    /* Keep the item in flow but make it invisible while dragging —
       the DragOverlay renders the floating ghost */
    opacity: isDragging || isDragSource ? 0 : 1,
    transition: isDragging ? 'none' : undefined,
  };

  const itemClass = [
    'jv-var-item',
    isSelected ? 'is-selected' : '',
    isUsed && !isSelected ? 'is-used' : '',
    isDragging || isDragSource ? 'is-dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={itemClass}
      title={variable.label ? `${variable.name} — ${variable.label}` : variable.name}
      /* Click/double-click stay on the wrapper div */
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      /* Spread dnd-kit pointer/keyboard listeners first,
         then override role/aria-* so our semantics win */
      {...attributes}
      {...listeners}
      role="option"
      aria-selected={isSelected}
      aria-grabbed={isDragging}
    >
      <VarIcon type={variable.type} />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <span className="jv-var-name">{variable.name}</span>
        {variable.label && (
          <span className="jv-var-label">{variable.label}</span>
        )}
      </div>

      {/* Drag handle affordance — subtle grip dots visible on hover */}
      <span className="jv-var-drag-handle" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drag overlay ghost card (rendered inside DragOverlay in parent)      */
/* ------------------------------------------------------------------ */

export interface DragGhostProps {
  variable: TransferVariable;
  count?: number;
}

export function DragGhost({ variable, count = 1 }: DragGhostProps) {
  const isMulti = count > 1;
  return (
    <div className={isMulti ? 'jv-drag-overlay jv-drag-overlay-multi' : 'jv-drag-overlay'}>
      {isMulti ? (
        <>
          <span className="jv-drag-overlay-multi-badge" aria-hidden="true">
            {count}
          </span>
          <span className="jv-drag-overlay-name">{count} variables</span>
        </>
      ) : (
        <>
          <span className={`jv-var-icon jv-var-icon--${variable.type}`} aria-hidden="true">
            {TYPE_SIGIL[variable.type]}
          </span>
          <span className="jv-drag-overlay-name">{variable.name}</span>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DraggableVariableList props                                           */
/* ------------------------------------------------------------------ */

export interface DraggableVariableListProps {
  variables: TransferVariable[];
  slots: Record<string, string[]>;
  slotSpecs: VariableSlot[];
  activeSlotId: string | null;
  selectedVars: Set<string>;
  onSelectVars: (names: Set<string>) => void;
  onTransferTo: (slotId: string, varName: string) => void;
  onRemoveVar: (varName: string) => void;
  onDoubleClickVar: (varName: string) => void;
  /** Names being dragged right now — used to ghost all selected rows. */
  draggingVarNames?: Set<string>;
}

/* ------------------------------------------------------------------ */
/* DraggableVariableList                                                 */
/* ------------------------------------------------------------------ */

export function DraggableVariableList({
  variables,
  slots,
  slotSpecs,
  activeSlotId,
  selectedVars,
  onSelectVars,
  onTransferTo,
  onRemoveVar,
  onDoubleClickVar,
  draggingVarNames,
}: DraggableVariableListProps) {
  const [search, setSearch] = useState('');

  /* Track the last-clicked item index for Shift+Click range selection */
  const lastClickedIndexRef = useRef<number | null>(null);

  /* Set of all variable names currently in any slot */
  const usedVars = useMemo(() => {
    const used = new Set<string>();
    for (const arr of Object.values(slots)) {
      for (const v of arr) used.add(v);
    }
    return used;
  }, [slots]);

  /* Filter by search query */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return variables;
    return variables.filter(
      v =>
        v.name.toLowerCase().includes(q) ||
        (v.label ?? '').toLowerCase().includes(q),
    );
  }, [variables, search]);

  /* ---- Multi-select click handler ---- */
  const handleItemClick = useCallback(
    (name: string, index: number, e: React.MouseEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      if (isShift && lastClickedIndexRef.current !== null) {
        /* Range selection */
        const start = Math.min(lastClickedIndexRef.current, index);
        const end   = Math.max(lastClickedIndexRef.current, index);
        const rangeNames = new Set(
          filtered.slice(start, end + 1).map(v => v.name),
        );
        /* Merge with existing if Ctrl is also held, otherwise replace */
        if (isCtrl) {
          onSelectVars(new Set([...selectedVars, ...rangeNames]));
        } else {
          onSelectVars(rangeNames);
        }
      } else if (isCtrl) {
        /* Toggle this item */
        const next = new Set(selectedVars);
        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
        }
        onSelectVars(next);
        lastClickedIndexRef.current = index;
      } else {
        /* Plain click — select only this item */
        if (selectedVars.size === 1 && selectedVars.has(name)) {
          /* Clicking the only selected item deselects it */
          onSelectVars(new Set());
          lastClickedIndexRef.current = null;
        } else {
          onSelectVars(new Set([name]));
          lastClickedIndexRef.current = index;
        }
      }
    },
    [filtered, selectedVars, onSelectVars],
  );

  /* Item double-click */
  const handleItemDoubleClick = useCallback(
    (name: string) => {
      onSelectVars(new Set());
      lastClickedIndexRef.current = null;
      onDoubleClickVar(name);
    },
    [onSelectVars, onDoubleClickVar],
  );

  /* Transfer-forward button — moves all selected vars to the active slot */
  const selectedVarList = useMemo(
    () => filtered.filter(v => selectedVars.has(v.name)),
    [filtered, selectedVars],
  );
  const canTransferForward = selectedVarList.length > 0 && activeSlotId !== null;

  const handleTransferForward = useCallback(() => {
    if (!activeSlotId || selectedVarList.length === 0) return;
    for (const v of selectedVarList) {
      onTransferTo(activeSlotId, v.name);
    }
    onSelectVars(new Set());
  }, [selectedVarList, activeSlotId, onTransferTo, onSelectVars]);

  /* Transfer-back button — removes all selected used vars from every slot */
  const canTransferBack = selectedVarList.some(v => usedVars.has(v.name));

  const handleTransferBack = useCallback(() => {
    for (const v of selectedVarList) {
      if (usedVars.has(v.name)) onRemoveVar(v.name);
    }
    onSelectVars(new Set());
  }, [selectedVarList, usedVars, onRemoveVar, onSelectVars]);

  const { t } = useTranslation();

  const targetSlotLabel = activeSlotId
    ? (slotSpecs.find(s => s.id === activeSlotId)?.label ?? activeSlotId)
    : null;

  return (
    <>
      {/* ---- Left: variable source list ---- */}
      <div className="jv-var-panel">
        <div className="jv-var-panel-header">
          <div className="jv-var-panel-title">{t('analysis.variables')}</div>
          <input
            className="jv-search-input"
            type="text"
            placeholder={t('analysis.search')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label={t('analysis.search')}
          />
        </div>

        <div className="jv-var-list" role="listbox" aria-multiselectable="true" aria-label={t('analysis.variables')}>
          {filtered.length === 0 && (
            <div
              style={{
                padding: '12px 8px',
                textAlign: 'center',
                fontSize: 'var(--jv-font-xs)',
                color: 'var(--jv-text-muted)',
              }}
            >
              {t('analysis.noVariables')}
            </div>
          )}

          {filtered.map((v, index) => (
            <DraggableVarItem
              key={v.name}
              variable={v}
              isSelected={selectedVars.has(v.name)}
              isUsed={usedVars.has(v.name)}
              isDragSource={!!(draggingVarNames?.has(v.name))}
              onClick={e => handleItemClick(v.name, index, e)}
              onDoubleClick={() => handleItemDoubleClick(v.name)}
            />
          ))}
        </div>

        <div className="jv-var-count">
          {filtered.length} {t('analysis.of')} {variables.length}{' '}
          {t('dataEditor.variables')}
          {selectedVars.size > 0 && (
            <span style={{ color: 'var(--jv-accent)', marginLeft: 4 }}>
              · {selectedVars.size} {t('analysis.selected')}
            </span>
          )}
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
