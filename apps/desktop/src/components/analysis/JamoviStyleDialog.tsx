/**
 * JamoviStyleDialog.tsx
 *
 * Drop-in replacement for AnalysisDialog with a polished Jamovi-inspired layout.
 *
 * Layout: Three-panel dialog
 *  [Left: DraggableVariableList] [Center: DroppableSlot zones] [Right: OptionsAccordion]
 *
 * Interaction model — two complementary paths:
 *  1. DRAG & DROP  (primary)
 *     - Drag a variable from the left list onto a center slot zone
 *     - When multiple variables are selected, dragging any one of them
 *       drags ALL selected variables as a group
 *     - DragOverlay renders a floating ghost card while dragging;
 *       the ghost shows a count badge when more than one variable is dragged
 *     - Slot zones highlight with an "accepting" state when hovered
 *
 *  2. CLICK-TO-TRANSFER  (fallback / accessibility)
 *     - Single click: select only that variable (clears others)
 *     - Ctrl/Cmd + Click: toggle variable in/out of selection
 *     - Shift + Click: extend selection range from last-clicked to current
 *     - Click a slot to activate it; all selected variables are added
 *     - Double-click a variable to add it to the first eligible slot
 *     - Arrow buttons (→ / ←) in the transfer column also move variables
 *     - × button on a chip removes it from its slot
 *
 * Styling: jamovi.css (.jv-*)
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import '../../styles/jamovi.css';

import type {
  AnalysisSpec,
  AnalysisRequest,
  OptionSpec,
} from '@method-studio/analysis-specs';

import { useAnalysisDialogStore } from '../../stores/analysis-dialog-store';

import { DraggableVariableList, DragGhost } from './DraggableVariableList';
import type { VariableDragData } from './DraggableVariableList';
import type { TransferVariable } from './VariableTransferList';
import { DroppableSlot } from './DroppableSlot';
import { OptionsAccordion } from './OptionsAccordion';

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export interface JamoviStyleDialogProps {
  spec: AnalysisSpec;
  datasetName: string;
  availableVariables: TransferVariable[];
  isOpen: boolean;
  onClose: () => void;
  onRun: (request: AnalysisRequest) => void;
  isRunning?: boolean;
  /**
   * When true, renders only the body + footer without the overlay backdrop
   * and dialog shell. Used when a parent component provides its own shell
   * (e.g. TTestDialog which adds a tab bar around multiple specs).
   */
  embedded?: boolean;
}

type SlotAssignment = Record<string, string[]>;
type OptionValues   = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function buildDefaultOptions(spec: AnalysisSpec): OptionValues {
  const out: OptionValues = {};
  for (const opt of spec.options) out[opt.id] = opt.default;
  return out;
}

function isReadyToRun(spec: AnalysisSpec, slots: SlotAssignment): boolean {
  return spec.variables
    .filter(v => v.required)
    .every(v => (slots[v.id] ?? []).length > 0);
}

function groupOptions(options: OptionSpec[]): Map<string, OptionSpec[]> {
  const map = new Map<string, OptionSpec[]>();
  for (const opt of options) {
    const key = opt.group ?? 'General';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(opt);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* JamoviStyleDialog (main export)                                       */
/* ------------------------------------------------------------------ */

export function JamoviStyleDialog({
  spec,
  datasetName,
  availableVariables,
  isOpen,
  onClose,
  onRun,
  isRunning = false,
  embedded = false,
}: JamoviStyleDialogProps) {
  const { t } = useTranslation();

  /* Dialog state persistence */
  const savedState = useAnalysisDialogStore((state) => state.getDialogState(spec.id));
  const saveDialogState = useAnalysisDialogStore((state) => state.saveDialogState);

  /* Slot assignments - restore from saved state if available */
  const [slots, setSlots] = useState<SlotAssignment>(() => {
    const availableNames = new Set(availableVariables.map(v => v.name));
    if (savedState?.slots) {
      // Validate saved slots against current spec and available variables
      const init: SlotAssignment = {};
      for (const v of spec.variables) {
        const savedVars = savedState.slots[v.id] ?? [];
        // Filter out variables that are no longer in the dataset
        init[v.id] = savedVars.filter(varName => availableNames.has(varName));
      }
      return init;
    }
    const init: SlotAssignment = {};
    for (const v of spec.variables) init[v.id] = [];
    return init;
  });

  /* Option values - restore from saved state if available */
  const [options, setOptions] = useState<OptionValues>(() => {
    const defaults = buildDefaultOptions(spec);
    if (savedState?.options) {
      return { ...defaults, ...savedState.options };
    }
    return defaults;
  });

  /* Engine selection - restore from saved state if available */
  const [engine, setEngine] = useState<'r' | 'python'>(
    savedState?.engine ?? 'r'
  );

  /* Save state whenever slots, options, or engine changes */
  useEffect(() => {
    saveDialogState(spec.id, { slots, options, engine });
  }, [spec.id, slots, options, engine, saveDialogState]);

  /* Source list multi-selection (click-to-transfer fallback) */
  const [selectedVars, setSelectedVars] = useState<Set<string>>(new Set());

  /* Active slot (click-to-transfer fallback focus) */
  const [activeSlot, setActiveSlot] = useState<string | null>(null);

  /**
   * Currently dragging state:
   *  - draggingPrimary: the variable whose row was grabbed (drives the ghost icon)
   *  - draggingVarNames: all variable names in this drag gesture (may be >1)
   */
  const [draggingPrimary, setDraggingPrimary] = useState<TransferVariable | null>(null);
  const [draggingVarNames, setDraggingVarNames] = useState<Set<string>>(new Set());

  /* dnd-kit sensors — pointer + keyboard for a11y */
  const sensors = useSensors(
    useSensor(PointerSensor, {
      /* Require a small movement before starting a drag so that
         click events still fire on stationary taps/clicks */
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  /* Derived option groups */
  const optionGroups = useMemo(
    () => groupOptions(spec.options),
    [spec.options],
  );

  /* Fast variable lookup map */
  const varByName = useMemo(
    () => new Map(availableVariables.map(v => [v.name, v])),
    [availableVariables],
  );

  /* ---- Slot mutations ---- */
  const addToSlot = useCallback(
    (slotId: string, varName: string) => {
      const slotSpec = spec.variables.find(s => s.id === slotId);
      if (!slotSpec) return;

      setSlots(prev => {
        const existing = prev[slotId] ?? [];
        if (existing.includes(varName)) return prev;
        if (!slotSpec.multiple) return { ...prev, [slotId]: [varName] };
        if (
          slotSpec.maxVariables !== undefined &&
          existing.length >= slotSpec.maxVariables
        )
          return prev;
        return { ...prev, [slotId]: [...existing, varName] };
      });
    },
    [spec.variables],
  );

  const removeFromSlot = useCallback((slotId: string, varName: string) => {
    setSlots(prev => ({
      ...prev,
      [slotId]: (prev[slotId] ?? []).filter(v => v !== varName),
    }));
  }, []);

  /* Remove a variable from ALL slots (used by ← transfer button) */
  const removeVarEverywhere = useCallback((varName: string) => {
    setSlots(prev => {
      const next: SlotAssignment = {};
      for (const [id, arr] of Object.entries(prev)) {
        next[id] = arr.filter(v => v !== varName);
      }
      return next;
    });
  }, []);

  /* ---- Double-click: add to first eligible empty slot ---- */
  const handleDoubleClickVar = useCallback(
    (varName: string) => {
      // Try required empty slots first
      for (const slotSpec of spec.variables) {
        const existing = slots[slotSpec.id] ?? [];
        if (slotSpec.required && existing.length === 0) {
          addToSlot(slotSpec.id, varName);
          return;
        }
      }
      // Fall back to any slot that can accept more
      for (const slotSpec of spec.variables) {
        const existing = slots[slotSpec.id] ?? [];
        if (existing.includes(varName)) continue;
        if (!slotSpec.multiple && existing.length > 0) continue;
        if (
          slotSpec.maxVariables !== undefined &&
          existing.length >= slotSpec.maxVariables
        )
          continue;
        addToSlot(slotSpec.id, varName);
        return;
      }
    },
    [spec.variables, slots, addToSlot],
  );

  /* ---- Slot click (click-to-transfer) ---- */
  const handleSlotClick = useCallback(
    (slotId: string) => {
      if (selectedVars.size > 0) {
        for (const varName of selectedVars) {
          addToSlot(slotId, varName);
        }
        setSelectedVars(new Set());
        setActiveSlot(null);
      } else {
        setActiveSlot(prev => (prev === slotId ? null : slotId));
      }
    },
    [selectedVars, addToSlot],
  );

  /* ---- dnd-kit: drag start ---- */
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current as VariableDragData | undefined;
      if (data?.kind === 'variable') {
        const primaryName = data.varNames[0];
        const primary = varByName.get(primaryName);
        if (!primary) return;

        /* If the dragged item is part of the current selection,
           carry the entire selection; otherwise drag just this item. */
        const dragSet =
          selectedVars.has(primaryName) && selectedVars.size > 1
            ? new Set(selectedVars)
            : new Set([primaryName]);

        setDraggingPrimary(primary);
        setDraggingVarNames(dragSet);
        /* Clear selection while dragging to avoid stale highlight state */
        setSelectedVars(new Set());
        setActiveSlot(null);
      }
    },
    [varByName, selectedVars],
  );

  /* ---- dnd-kit: drag end ---- */
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const currentDraggingVarNames = draggingVarNames;
      setDraggingPrimary(null);
      setDraggingVarNames(new Set());

      const dropData = event.over?.data.current as { kind: string; slotId: string } | undefined;

      if (dropData?.kind === 'slot' && dropData.slotId) {
        for (const varName of currentDraggingVarNames) {
          addToSlot(dropData.slotId, varName);
        }
      }
    },
    [draggingVarNames, addToSlot],
  );

  /* ---- Run ---- */
  const handleRun = useCallback(() => {
    onRun({
      specId: spec.id,
      variables: slots,
      options,
      engine,
      datasetName,
    });
  }, [spec.id, slots, options, engine, datasetName, onRun]);

  /* ---- Close ---- */
  const handleClose = useCallback(() => {
    setSelectedVars(new Set());
    setActiveSlot(null);
    setDraggingPrimary(null);
    setDraggingVarNames(new Set());
    onClose();
  }, [onClose]);

  /* ---- Reset: clear saved state and reset to defaults ---- */
  const clearDialogState = useAnalysisDialogStore((state) => state.clearDialogState);
  const handleReset = useCallback(() => {
    // Reset slots to empty
    const emptySlots: SlotAssignment = {};
    for (const v of spec.variables) emptySlots[v.id] = [];
    setSlots(emptySlots);
    // Reset options to defaults
    setOptions(buildDefaultOptions(spec));
    // Reset engine to default
    setEngine('r');
    // Clear selection state
    setSelectedVars(new Set());
    setActiveSlot(null);
    // Clear persisted state
    clearDialogState(spec.id);
  }, [spec, clearDialogState]);

  if (!isOpen) return null;

  const ready = isReadyToRun(spec, slots);

  /* Shared inner content: 3-panel body + footer */
  const innerContent = (
    <>
      {/* ---- Body: 3-panel layout ---- */}
      <div className="jv-dialog-body">
        {/* LEFT: draggable variable source list + arrow column */}
        <DraggableVariableList
          variables={availableVariables}
          slots={slots}
          slotSpecs={spec.variables}
          activeSlotId={activeSlot}
          selectedVars={selectedVars}
          onSelectVars={setSelectedVars}
          draggingVarNames={draggingVarNames}
          onTransferTo={(slotId, varName) => {
            addToSlot(slotId, varName);
            setSelectedVars(new Set());
          }}
          onRemoveVar={removeVarEverywhere}
          onDoubleClickVar={handleDoubleClickVar}
        />

        {/* CENTER: droppable variable slot zones */}
        <div className="jv-slots-panel">
          {spec.variables.map(slotSpec => (
            <DroppableSlot
              key={slotSpec.id}
              slotId={slotSpec.id}
              label={slotSpec.label}
              required={slotSpec.required}
              hint={slotSpec.hint}
              multiple={slotSpec.multiple}
              isActive={activeSlot === slotSpec.id}
              vars={slots[slotSpec.id] ?? []}
              allVars={availableVariables}
              onClick={() => handleSlotClick(slotSpec.id)}
              onRemove={varName => removeFromSlot(slotSpec.id, varName)}
            />
          ))}
        </div>

        {/* RIGHT: collapsible options */}
        <OptionsAccordion
          optionGroups={optionGroups}
          values={options}
          onChange={(optId, val) =>
            setOptions(prev => ({ ...prev, [optId]: val }))
          }
        />
      </div>

      {/* ---- Footer ---- */}
      <div className="jv-dialog-footer">
        {/* Engine selector */}
        <div className="jv-engine-group">
          <span className="jv-engine-label">{t('analysis.engine')}</span>
          {(['r', 'python'] as const).map(eng => (
            <label key={eng} className="jv-engine-radio">
              <input
                type="radio"
                name={`jv-engine-${spec.id}`}
                value={eng}
                checked={engine === eng}
                onChange={() => setEngine(eng)}
              />
              {eng === 'r' ? 'R' : 'Python'}
            </label>
          ))}
        </div>

        {/* Action buttons */}
        <div className="jv-footer-buttons">
          <button
            className="jv-btn jv-btn-reset"
            onClick={handleReset}
            type="button"
            title="Reset all fields to defaults"
          >
            {t('analysis.reset')}
          </button>
          <button
            className="jv-btn jv-btn-cancel"
            onClick={handleClose}
            type="button"
          >
            {t('analysis.cancel')}
          </button>
          <button
            className={`jv-btn jv-btn-ok${isRunning ? ' is-running' : ''}`}
            onClick={handleRun}
            disabled={!ready || isRunning}
            type="button"
            aria-busy={isRunning}
          >
            {isRunning && <span className="jv-running-spinner" aria-hidden="true" />}
            {isRunning ? t('analysis.running') : t('analysis.run')}
          </button>
        </div>
      </div>
    </>
  );

  /* ---- DragOverlay: floating ghost rendered in a portal ---- */
  const dragOverlay = (
    <DragOverlay dropAnimation={{
      duration: 180,
      easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
    }}>
      {draggingPrimary ? (
        <DragGhost
          variable={draggingPrimary}
          count={draggingVarNames.size}
        />
      ) : null}
    </DragOverlay>
  );

  /* ---- Embedded mode: no overlay/shell, renders body+footer directly ---- */
  if (embedded) {
    return (
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {innerContent}
        {dragOverlay}
      </DndContext>
    );
  }

  /* ---- Standalone mode: full overlay + dialog shell ---- */
  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="jv-overlay" onClick={handleClose}>
        <div
          className="jv-dialog"
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={spec.name}
        >
          {/* ---- Header ---- */}
          <div className="jv-dialog-header">
            <div className="jv-dialog-header-left">
              <span className="jv-dialog-eyebrow">{t('app.analysis')}</span>
              <span className="jv-dialog-title">{spec.name}</span>
            </div>
            <button
              className="jv-dialog-close"
              onClick={handleClose}
              aria-label="Close dialog"
              type="button"
            >
              &times;
            </button>
          </div>

          {innerContent}
        </div>
      </div>
      {dragOverlay}
    </DndContext>
  );
}

/* ------------------------------------------------------------------ */
/* Re-export sub-components for individual use                          */
/* ------------------------------------------------------------------ */
export type { TransferVariable } from './VariableTransferList';
export { VariableTransferList } from './VariableTransferList';
export { OptionsAccordion } from './OptionsAccordion';
