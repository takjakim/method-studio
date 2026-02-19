/**
 * DroppableSlot.tsx
 *
 * A single variable slot drop-zone that accepts dragged variables
 * from DraggableVariableList.
 *
 * Uses @dnd-kit/core useDroppable to register as a valid drop target.
 * The slot id is used as the droppable id so that the parent DndContext
 * can identify which slot received the drop in onDragEnd.
 *
 * Visual states:
 *   - default:      dashed border, empty placeholder text
 *   - is-active:    solid accent border (click-to-activate fallback)
 *   - has-vars:     filled, solid accent border, chip pills
 *   - is-drag-over: highlighted with a distinct "accepting" treatment
 *
 * Styling: jamovi.css (.jv-slot-drop-zone, .jv-slot-drop-zone.is-drag-over)
 */

import { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { TransferVariable } from './VariableTransferList';

/* ------------------------------------------------------------------ */
/* Variable type colour map for chip dots                               */
/* ------------------------------------------------------------------ */

const CHIP_ICON_COLOR: Record<TransferVariable['type'], string> = {
  numeric: 'var(--jv-type-numeric)',
  string:  'var(--jv-type-string)',
  date:    'var(--jv-type-date)',
};

/* ------------------------------------------------------------------ */
/* Accept-indicator SVG                                                  */
/* ------------------------------------------------------------------ */

function AcceptIndicator() {
  return (
    <svg
      className="jv-slot-accept-icon"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5 8h6M8 5v6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* DroppableSlot props                                                   */
/* ------------------------------------------------------------------ */

export interface DroppableSlotProps {
  slotId: string;
  label: string;
  required: boolean;
  hint?: string;
  /** Whether the click-based activation is active */
  isActive: boolean;
  /** Names of variables assigned to this slot */
  vars: string[];
  /** All available variables (for type look-up) */
  allVars: TransferVariable[];
  /** Whether we accept multiple variables */
  multiple?: boolean;
  /** Called when user clicks the zone (click-to-activate) */
  onClick: () => void;
  /** Called when the × on a chip is clicked */
  onRemove: (varName: string) => void;
}

/* ------------------------------------------------------------------ */
/* DroppableSlot                                                         */
/* ------------------------------------------------------------------ */

export function DroppableSlot({
  slotId,
  label,
  required,
  hint,
  isActive,
  vars,
  allVars,
  multiple = false,
  onClick,
  onRemove,
}: DroppableSlotProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot-${slotId}`,
    data: { kind: 'slot', slotId },
  });

  const hasVars = vars.length > 0;

  /* Build a fast varName→meta map */
  const varMeta = useMemo(() => {
    return new Map(allVars.map(v => [v.name, v]));
  }, [allVars]);

  const zoneClass = [
    'jv-slot-drop-zone',
    isActive    ? 'is-active'    : '',
    hasVars     ? 'has-vars'     : '',
    isOver      ? 'is-drag-over' : '',
  ]
    .filter(Boolean)
    .join(' ');

  /* Determine placeholder copy */
  let placeholder = 'Drop variable here';
  if (isOver) {
    placeholder = multiple ? 'Add variable' : 'Replace variable';
  } else if (isActive) {
    placeholder = 'Click a variable to add';
  }

  return (
    <div className="jv-slot-group">
      <label className="jv-slot-label" htmlFor={`slot-${slotId}`}>
        {label}
        {required && (
          <span className="jv-slot-required-mark" aria-label="required">
            *
          </span>
        )}
        {hint && !hasVars && (
          <span className="jv-slot-hint">{hint}</span>
        )}
        {/* "multiple" badge */}
        {multiple && (
          <span className="jv-slot-multi-badge" title="Accepts multiple variables">
            1+
          </span>
        )}
      </label>

      <div
        ref={setNodeRef}
        id={`slot-${slotId}`}
        className={zoneClass}
        onClick={onClick}
        role="group"
        aria-label={`${label} slot${required ? ' (required)' : ''}`}
        aria-dropeffect="move"
      >
        {/* Animated accept indicator shown during drag-over */}
        {isOver && <AcceptIndicator />}

        {/* Placeholder when empty */}
        {!hasVars && (
          <span className="jv-slot-placeholder">
            {placeholder}
          </span>
        )}

        {/* Variable chips */}
        {vars.map(varName => {
          const meta = varMeta.get(varName);
          return (
            <span key={varName} className="jv-chip">
              {meta && (
                <span
                  className="jv-chip-icon"
                  style={{ backgroundColor: CHIP_ICON_COLOR[meta.type] }}
                  aria-hidden="true"
                />
              )}
              <span className="jv-chip-name" title={varName}>
                {varName}
              </span>
              <button
                className="jv-chip-remove"
                onClick={e => {
                  e.stopPropagation();
                  onRemove(varName);
                }}
                aria-label={`Remove ${varName}`}
                type="button"
              >
                &times;
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
