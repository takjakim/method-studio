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
import type { AnalysisRequest, VariableSlot } from '@method-studio/analysis-specs';
import type { Variable } from '../../types/data';
import { DraggableVariableList, DragGhost } from '../../components/analysis/DraggableVariableList';
import type { VariableDragData } from '../../components/analysis/DraggableVariableList';
import type { TransferVariable } from '../../components/analysis/VariableTransferList';
import { DroppableSlot } from '../../components/analysis/DroppableSlot';
import { OptionsAccordion } from '../../components/analysis/OptionsAccordion';
import { useAnalysisDialogStore } from '../../stores/analysis-dialog-store';
import '../../styles/jamovi.css';

interface CFADialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRun: (request: AnalysisRequest) => void;
  variables: Variable[];
  datasetName: string;
  isRunning?: boolean;
}

interface FactorSlot {
  id: string;
  label: string;
  variables: string[];
}

const SPEC_ID = 'cfa';

function buildOptions(t: (key: string) => string) {
  return [
    {
      id: 'estimator',
      type: 'select' as const,
      label: t('analyses.cfa.estimator'),
      default: 'ML',
      choices: [
        { value: 'ML', label: t('analyses.cfa.ml') },
        { value: 'MLR', label: t('analyses.cfa.mlr') },
        { value: 'WLSMV', label: t('analyses.cfa.wlsmv') },
      ],
      group: 'Model',
    },
    {
      id: 'orthogonal',
      type: 'checkbox' as const,
      label: t('analyses.cfa.orthogonal'),
      default: false,
      group: 'Model',
    },
    {
      id: 'standardized',
      type: 'checkbox' as const,
      label: t('analyses.cfa.standardized'),
      default: true,
      group: 'Output',
    },
    {
      id: 'fitIndices',
      type: 'checkbox' as const,
      label: t('analyses.cfa.fitIndices'),
      default: true,
      group: 'Output',
    },
    {
      id: 'modificationIndices',
      type: 'checkbox' as const,
      label: t('analyses.cfa.modificationIndices'),
      default: false,
      group: 'Output',
    },
    {
      id: 'residualCorrelations',
      type: 'checkbox' as const,
      label: t('analyses.cfa.residualCorrelations'),
      default: false,
      group: 'Output',
    },
    {
      id: 'missingValues',
      type: 'select' as const,
      label: t('analyses.cfa.missingValues'),
      default: 'listwise',
      choices: [
        { value: 'listwise', label: t('analyses.cfa.listwise') },
        { value: 'fiml', label: t('analyses.cfa.fiml') },
      ],
      group: 'Options',
    },
  ];
}

type OptionsArray = ReturnType<typeof buildOptions>;

function buildDefaultOptions(): Record<string, unknown> {
  // Use static defaults; labels are not needed here
  return {
    estimator: 'ML',
    orthogonal: false,
    standardized: true,
    fitIndices: true,
    modificationIndices: false,
    residualCorrelations: false,
    missingValues: 'listwise',
  };
}

function groupOptions(options: OptionsArray) {
  const map = new Map<string, OptionsArray>();
  for (const opt of options) {
    const key = opt.group ?? 'General';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(opt);
  }
  return map;
}

export function CFADialog({
  isOpen,
  onClose,
  onRun,
  variables,
  datasetName,
  isRunning = false,
}: CFADialogProps) {
  const { t } = useTranslation();

  // Dialog state persistence
  const savedState = useAnalysisDialogStore((state) => state.getDialogState(SPEC_ID));
  const saveDialogState = useAnalysisDialogStore((state) => state.saveDialogState);
  const clearDialogState = useAnalysisDialogStore((state) => state.clearDialogState);

  // Available variables
  const availableVariables: TransferVariable[] = useMemo(
    () => variables.map(v => ({
      name: v.name,
      type: v.type as 'numeric' | 'string' | 'date',
      label: v.label,
    })),
    [variables]
  );

  const availableVarNames = useMemo(
    () => new Set(availableVariables.map(v => v.name)),
    [availableVariables]
  );

  // Factor slots state
  const [factors, setFactors] = useState<FactorSlot[]>(() => {
    if (savedState?.slots) {
      // Restore factors from saved state
      const restored: FactorSlot[] = [];
      let i = 1;
      while (savedState.slots[`factor${i}`]) {
        const vars = savedState.slots[`factor${i}`].filter(v => availableVarNames.has(v));
        restored.push({
          id: `factor${i}`,
          label: `${t('analyses.cfa.factor')} ${i}`,
          variables: vars,
        });
        i++;
      }
      if (restored.length > 0) return restored;
    }
    // Default: start with 1 factor
    return [{ id: 'factor1', label: `${t('analyses.cfa.factor')} 1`, variables: [] }];
  });

  // Options state
  const [options, setOptions] = useState<Record<string, unknown>>(() => {
    const defaults = buildDefaultOptions();
    if (savedState?.options) {
      return { ...defaults, ...savedState.options };
    }
    return defaults;
  });

  // Engine state
  const [engine, setEngine] = useState<'r' | 'python'>(savedState?.engine ?? 'r');

  // Save state on changes
  useEffect(() => {
    const slots: Record<string, string[]> = {};
    factors.forEach(f => {
      slots[f.id] = f.variables;
    });
    saveDialogState(SPEC_ID, { slots, options, engine });
  }, [factors, options, engine, saveDialogState]);

  // DnD state
  const [selectedVars, setSelectedVars] = useState<Set<string>>(new Set());
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [draggingPrimary, setDraggingPrimary] = useState<TransferVariable | null>(null);
  const [draggingVarNames, setDraggingVarNames] = useState<Set<string>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const optionGroups = useMemo(() => groupOptions(buildOptions(t)), [t]);

  const varByName = useMemo(
    () => new Map(availableVariables.map(v => [v.name, v])),
    [availableVariables]
  );

  // Convert factors to slots record for DraggableVariableList
  const slotsRecord = useMemo(() => {
    const record: Record<string, string[]> = {};
    factors.forEach(f => {
      record[f.id] = f.variables;
    });
    return record;
  }, [factors]);

  // Create slot specs for DraggableVariableList
  const slotSpecs: VariableSlot[] = useMemo(() => {
    return factors.map((f, index) => ({
      id: f.id,
      label: f.label,
      accepts: ['numeric'] as const,
      multiple: true,
      required: index === 0,
      minVariables: index === 0 ? 2 : undefined,
      hint: index === 0 ? t('analyses.cfa.indicatorsRequired') : t('analyses.cfa.indicatorsOptional'),
    }));
  }, [factors, t]);

  // Add variable to a factor
  const addToFactor = useCallback((factorId: string, varName: string) => {
    setFactors(prev => prev.map(f => {
      if (f.id !== factorId) return f;
      if (f.variables.includes(varName)) return f;
      return { ...f, variables: [...f.variables, varName] };
    }));
  }, []);

  // Remove variable from a factor
  const removeFromFactor = useCallback((factorId: string, varName: string) => {
    setFactors(prev => prev.map(f => {
      if (f.id !== factorId) return f;
      return { ...f, variables: f.variables.filter(v => v !== varName) };
    }));
  }, []);

  // Remove variable from any factor (for transfer back button)
  const handleRemoveVar = useCallback((varName: string) => {
    setFactors(prev => prev.map(f => ({
      ...f,
      variables: f.variables.filter(v => v !== varName),
    })));
  }, []);

  // Add a new factor
  const addFactor = useCallback(() => {
    setFactors(prev => {
      const nextNum = prev.length + 1;
      return [...prev, { id: `factor${nextNum}`, label: `${t('analyses.cfa.factor')} ${nextNum}`, variables: [] }];
    });
  }, [t]);

  // Remove a factor
  const removeFactor = useCallback((factorId: string) => {
    setFactors(prev => {
      if (prev.length <= 1) return prev; // Keep at least one factor
      const filtered = prev.filter(f => f.id !== factorId);
      // Renumber factors
      return filtered.map((f, i) => ({
        ...f,
        id: `factor${i + 1}`,
        label: `${t('analyses.cfa.factor')} ${i + 1}`,
      }));
    });
  }, [t]);

  // Double-click: add to first factor with room
  const handleDoubleClickVar = useCallback((varName: string) => {
    for (const factor of factors) {
      if (!factor.variables.includes(varName)) {
        addToFactor(factor.id, varName);
        return;
      }
    }
  }, [factors, addToFactor]);

  // Slot click
  const handleSlotClick = useCallback((factorId: string) => {
    if (selectedVars.size > 0) {
      for (const varName of selectedVars) {
        addToFactor(factorId, varName);
      }
      setSelectedVars(new Set());
      setActiveSlot(null);
    } else {
      setActiveSlot(prev => (prev === factorId ? null : factorId));
    }
  }, [selectedVars, addToFactor]);

  // DnD handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as VariableDragData | undefined;
    if (data?.kind === 'variable') {
      const primaryName = data.varNames[0];
      const primary = varByName.get(primaryName);
      if (!primary) return;

      const dragSet = selectedVars.has(primaryName) && selectedVars.size > 1
        ? new Set(selectedVars)
        : new Set([primaryName]);

      setDraggingPrimary(primary);
      setDraggingVarNames(dragSet);
    }
  }, [varByName, selectedVars]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { over } = event;
    if (over && draggingVarNames.size > 0) {
      const targetId = String(over.id);
      if (targetId.startsWith('factor')) {
        for (const varName of draggingVarNames) {
          addToFactor(targetId, varName);
        }
        setSelectedVars(new Set());
      }
    }
    setDraggingPrimary(null);
    setDraggingVarNames(new Set());
  }, [draggingVarNames, addToFactor]);

  // Check if ready to run (at least one factor with 2+ variables)
  const ready = factors.some(f => f.variables.length >= 2);

  // Run handler
  const handleRun = useCallback(() => {
    const vars: Record<string, string[]> = {};
    factors.forEach(f => {
      vars[f.id] = f.variables;
    });

    onRun({
      specId: SPEC_ID,
      variables: vars,
      options,
      engine,
      datasetName,
    });
  }, [factors, options, engine, datasetName, onRun]);

  // Close handler
  const handleClose = useCallback(() => {
    setSelectedVars(new Set());
    setActiveSlot(null);
    setDraggingPrimary(null);
    setDraggingVarNames(new Set());
    onClose();
  }, [onClose]);

  // Reset handler
  const handleReset = useCallback(() => {
    setFactors([{ id: 'factor1', label: `${t('analyses.cfa.factor')} 1`, variables: [] }]);
    setOptions(buildDefaultOptions());
    setEngine('r');
    setSelectedVars(new Set());
    setActiveSlot(null);
    clearDialogState(SPEC_ID);
  }, [t, clearDialogState]);

  if (!isOpen) return null;

  return (
    <div className="jv-dialog-overlay">
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="jv-dialog" style={{ maxWidth: '900px' }}>
          {/* Header */}
          <div className="jv-dialog-header">
            <h2 className="jv-dialog-title">{t('analyses.cfa.title')}</h2>
            <button className="jv-dialog-close" onClick={handleClose} aria-label="Close">×</button>
          </div>

          {/* Body */}
          <div className="jv-dialog-body">
            {/* Left: Variable list */}
            <DraggableVariableList
              variables={availableVariables}
              slots={slotsRecord}
              slotSpecs={slotSpecs}
              activeSlotId={activeSlot}
              selectedVars={selectedVars}
              onSelectVars={setSelectedVars}
              onTransferTo={addToFactor}
              onRemoveVar={handleRemoveVar}
              onDoubleClickVar={handleDoubleClickVar}
              draggingVarNames={draggingVarNames}
            />

            {/* Center: Factor slots */}
            <div className="jv-slots-panel" style={{ minWidth: '320px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span className="jv-panel-header">{t('analyses.cfa.factors')} ({factors.length})</span>
                <button
                  onClick={addFactor}
                  className="jv-btn"
                  style={{ padding: '4px 12px', fontSize: '12px' }}
                  title={t('analyses.cfa.addFactor')}
                >
                  {t('analyses.cfa.addFactor')}
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto' }}>
                {factors.map((factor, index) => (
                  <div key={factor.id} style={{ position: 'relative' }}>
                    <DroppableSlot
                      slotId={factor.id}
                      label={factor.label}
                      required={index === 0}
                      hint={index === 0 ? t('analyses.cfa.indicatorsRequired') : t('analyses.cfa.indicatorsOptional')}
                      multiple={true}
                      isActive={activeSlot === factor.id}
                      vars={factor.variables}
                      allVars={availableVariables}
                      onClick={() => handleSlotClick(factor.id)}
                      onRemove={(varName) => removeFromFactor(factor.id, varName)}
                    />
                    {factors.length > 1 && (
                      <button
                        onClick={() => removeFactor(factor.id)}
                        style={{
                          position: 'absolute',
                          top: '4px',
                          right: '4px',
                          background: 'none',
                          border: 'none',
                          color: '#999',
                          cursor: 'pointer',
                          fontSize: '14px',
                          padding: '2px 6px',
                        }}
                        title={t('analyses.cfa.removeFactor')}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Options */}
            <OptionsAccordion
              optionGroups={optionGroups}
              values={options}
              onChange={(optId, val) => setOptions(prev => ({ ...prev, [optId]: val }))}
            />
          </div>

          {/* Footer */}
          <div className="jv-dialog-footer">
            {/* Engine selector */}
            <div className="jv-engine-group">
              <span className="jv-engine-label">{t('analysis.engine')}</span>
              {(['r', 'python'] as const).map(eng => (
                <label key={eng} className="jv-engine-radio">
                  <input
                    type="radio"
                    name="jv-engine-cfa"
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
              <button className="jv-btn jv-btn-reset" onClick={handleReset} type="button" title={t('analysis.reset')}>
                {t('analysis.reset')}
              </button>
              <button className="jv-btn jv-btn-cancel" onClick={handleClose} type="button">
                {t('analysis.cancel')}
              </button>
              <button
                className={`jv-btn jv-btn-ok${isRunning ? ' is-running' : ''}`}
                onClick={handleRun}
                disabled={!ready || isRunning}
                type="button"
              >
                {isRunning && <span className="jv-running-spinner" />}
                {isRunning ? t('analysis.running') : t('analysis.run')}
              </button>
            </div>
          </div>
        </div>

        {/* Drag overlay */}
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
          {draggingPrimary ? (
            <DragGhost variable={draggingPrimary} count={draggingVarNames.size} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// Convenience hook for managing open state
export function useCFADialog() {
  const [isOpen, setIsOpen] = useState(false);
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}
