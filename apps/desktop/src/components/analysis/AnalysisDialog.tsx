import { useState, useCallback } from 'react';
import type { AnalysisSpec, AnalysisRequest, OptionSpec } from '@method-studio/analysis-specs';

interface AnalysisDialogProps {
  spec: AnalysisSpec;
  datasetName: string;
  availableVariables: { name: string; type: 'numeric' | 'string' | 'date'; label?: string }[];
  isOpen: boolean;
  onClose: () => void;
  onRun: (request: AnalysisRequest) => void;
  isRunning?: boolean;
}

type SlotAssignment = Record<string, string[]>;
type OptionValues = Record<string, unknown>;

function getDefaultOptions(spec: AnalysisSpec): OptionValues {
  const defaults: OptionValues = {};
  for (const opt of spec.options) {
    defaults[opt.id] = opt.default;
  }
  return defaults;
}

function isRequestReady(spec: AnalysisSpec, slots: SlotAssignment): boolean {
  return spec.variables
    .filter(v => v.required)
    .every(v => (slots[v.id] ?? []).length > 0);
}

/** Group options by their `group` field */
function groupOptions(options: OptionSpec[]): Map<string, OptionSpec[]> {
  const map = new Map<string, OptionSpec[]>();
  for (const opt of options) {
    const key = opt.group ?? 'General';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(opt);
  }
  return map;
}

export function AnalysisDialog({
  spec,
  datasetName,
  availableVariables,
  isOpen,
  onClose,
  onRun,
  isRunning = false,
}: AnalysisDialogProps) {
  const [slots, setSlots] = useState<SlotAssignment>(() => {
    const init: SlotAssignment = {};
    for (const v of spec.variables) init[v.id] = [];
    return init;
  });
  const [options, setOptions] = useState<OptionValues>(() => getDefaultOptions(spec));
  const [engine, setEngine] = useState<'r' | 'python'>('r');
  // Click-based selection (WebKit-compatible, no drag-drop)
  const [selectedVar, setSelectedVar] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<string | null>(null);

  // Add variable to slot
  const addToSlot = useCallback((slotId: string, varName: string) => {
    const slotSpec = spec.variables.find(s => s.id === slotId);
    if (!slotSpec) return;

    setSlots(prev => {
      const existing = prev[slotId] ?? [];
      if (existing.includes(varName)) return prev;
      if (!slotSpec.multiple) return { ...prev, [slotId]: [varName] };
      if (slotSpec.maxVariables && existing.length >= slotSpec.maxVariables) return prev;
      return { ...prev, [slotId]: [...existing, varName] };
    });
  }, [spec.variables]);

  // Handle variable click - select or add to active slot
  const handleVariableClick = useCallback((varName: string) => {
    if (activeSlot) {
      // If a slot is active, add variable to it
      addToSlot(activeSlot, varName);
    } else {
      // Toggle selection
      setSelectedVar(prev => prev === varName ? null : varName);
    }
  }, [activeSlot, addToSlot]);

  // Handle variable double-click - add to first empty required slot
  const handleVariableDoubleClick = useCallback((varName: string) => {
    // Find first required slot that's empty or can accept more
    for (const slotSpec of spec.variables) {
      const existing = slots[slotSpec.id] ?? [];
      if (slotSpec.required && existing.length === 0) {
        addToSlot(slotSpec.id, varName);
        return;
      }
    }
    // If no empty required slot, try first slot that can accept
    for (const slotSpec of spec.variables) {
      const existing = slots[slotSpec.id] ?? [];
      if (!existing.includes(varName)) {
        if (!slotSpec.multiple && existing.length > 0) continue;
        if (slotSpec.maxVariables && existing.length >= slotSpec.maxVariables) continue;
        addToSlot(slotSpec.id, varName);
        return;
      }
    }
  }, [spec.variables, slots, addToSlot]);

  // Handle slot click - set active or add selected variable
  const handleSlotClick = useCallback((slotId: string) => {
    if (selectedVar) {
      // Add selected variable to clicked slot
      addToSlot(slotId, selectedVar);
      setSelectedVar(null);
    } else {
      // Toggle active slot
      setActiveSlot(prev => prev === slotId ? null : slotId);
    }
  }, [selectedVar, addToSlot]);

  const handleRemoveFromSlot = useCallback((slotId: string, varName: string) => {
    setSlots(prev => ({
      ...prev,
      [slotId]: (prev[slotId] ?? []).filter(v => v !== varName),
    }));
  }, []);

  const handleOptionChange = useCallback((optId: string, value: unknown) => {
    setOptions(prev => ({ ...prev, [optId]: value }));
  }, []);

  const handleRun = () => {
    onRun({
      specId: spec.id,
      variables: slots,
      options,
      engine,
      datasetName,
    });
  };

  if (!isOpen) return null;

  const ready = isRequestReady(spec, slots);
  const optionGroups = groupOptions(spec.options);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white border border-gray-300 rounded-lg shadow-xl w-[720px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-100 border-b border-gray-200 rounded-t-lg">
          <h2 className="text-sm font-semibold text-gray-800">{spec.name}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-lg leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: variable list */}
          <div className="w-48 border-r border-gray-200 flex flex-col bg-gray-50">
            <div className="text-xs font-medium text-gray-500 px-3 pt-3 pb-2 uppercase tracking-wide">
              Variables
              <span className="text-gray-400 font-normal normal-case ml-1">(click to select)</span>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2">
              {availableVariables.map(v => {
                const isSelected = selectedVar === v.name;
                const isInSlot = Object.values(slots).some(arr => arr.includes(v.name));
                return (
                  <div
                    key={v.name}
                    onClick={() => handleVariableClick(v.name)}
                    onDoubleClick={() => handleVariableDoubleClick(v.name)}
                    className={`flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer select-none mb-0.5 transition-colors ${
                      isSelected
                        ? 'bg-blue-500 text-white'
                        : isInSlot
                          ? 'bg-green-100 text-green-800 hover:bg-green-200'
                          : 'text-gray-800 hover:bg-gray-200'
                    }`}
                  >
                    <span
                      className={`w-3 h-3 rounded-sm flex-shrink-0 ${
                        v.type === 'numeric' ? 'bg-blue-400' : v.type === 'string' ? 'bg-amber-400' : 'bg-green-400'
                      }`}
                    />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className={`font-medium truncate ${isSelected ? 'text-white' : 'text-gray-900'}`}>{v.name}</span>
                      {v.label && (
                        <span className={`text-[10px] truncate ${isSelected ? 'text-blue-100' : 'text-gray-500'}`}>{v.label}</span>
                      )}
                    </div>
                    {isInSlot && !isSelected && <span className="ml-auto text-green-600 flex-shrink-0">✓</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Center: variable slots */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <p className="text-xs text-gray-500 mb-2">
              Double-click variable to add, or click variable then click slot
            </p>
            {spec.variables.map(slot => {
              const isActive = activeSlot === slot.id;
              const slotVars = slots[slot.id] ?? [];
              return (
                <div key={slot.id}>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    {slot.label}
                    {slot.required && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                  <div
                    onClick={() => handleSlotClick(slot.id)}
                    className={`min-h-[52px] border-2 rounded p-2 cursor-pointer transition-colors ${
                      isActive
                        ? 'border-blue-500 bg-blue-50'
                        : slotVars.length > 0
                          ? 'border-green-300 bg-green-50'
                          : 'border-dashed border-gray-300 bg-gray-50 hover:border-gray-400'
                    }`}
                  >
                    {slotVars.length === 0 ? (
                      <p className={`text-xs text-center py-1 ${isActive ? 'text-blue-500' : 'text-gray-400'}`}>
                        {isActive ? 'Click a variable to add here' : (slot.hint ?? 'Click to activate, then select variables')}
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {slotVars.map(v => (
                          <div
                            key={v}
                            className="flex items-center bg-blue-100 text-blue-800 text-xs rounded px-2 py-1"
                          >
                            <span>{v}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveFromSlot(slot.id, v);
                              }}
                              className="ml-1.5 text-blue-500 hover:text-blue-700 font-bold"
                              aria-label={`Remove ${v}`}
                            >
                              &times;
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: options panel */}
          <div className="w-52 border-l border-gray-200 overflow-y-auto p-3 space-y-4 bg-gray-50">
            {Array.from(optionGroups.entries()).map(([groupName, opts]) => (
              <div key={groupName}>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  {groupName}
                </div>
                <div className="space-y-2">
                  {opts.map(opt => (
                    <OptionControl
                      key={opt.id}
                      opt={opt}
                      value={options[opt.id]}
                      onChange={val => handleOptionChange(opt.id, val)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-100 border-t border-gray-200 rounded-b-lg">
          {/* Engine selector */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-600">Engine:</span>
            {(['r', 'python'] as const).map(eng => (
              <label key={eng} className="flex items-center gap-1.5 text-xs cursor-pointer text-gray-700">
                <input
                  type="radio"
                  name="engine"
                  value={eng}
                  checked={engine === eng}
                  onChange={() => setEngine(eng)}
                  className="accent-blue-600"
                />
                {eng === 'r' ? 'R' : 'Python'}
              </label>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-200 text-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={handleRun}
              disabled={!ready || isRunning}
              className="px-5 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isRunning ? 'Running…' : 'OK'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal: individual option control
// ---------------------------------------------------------------------------

interface OptionControlProps {
  opt: OptionSpec;
  value: unknown;
  onChange: (value: unknown) => void;
}

function OptionControl({ opt, value, onChange }: OptionControlProps) {
  switch (opt.type) {
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-xs cursor-pointer text-gray-700">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={e => onChange(e.target.checked)}
            className="accent-blue-600"
          />
          {opt.label}
        </label>
      );

    case 'radio':
      return (
        <div>
          <div className="text-xs text-gray-600 mb-1">{opt.label}</div>
          {(opt.choices ?? []).map(choice => (
            <label key={String(choice.value)} className="flex items-center gap-2 text-xs cursor-pointer text-gray-700 mb-0.5">
              <input
                type="radio"
                name={opt.id}
                value={String(choice.value)}
                checked={value === choice.value}
                onChange={() => onChange(choice.value)}
                className="accent-blue-600"
              />
              {choice.label}
            </label>
          ))}
        </div>
      );

    case 'select':
      return (
        <div>
          <label className="block text-xs text-gray-600 mb-1">{opt.label}</label>
          <select
            value={String(value)}
            onChange={e => {
              const chosen = opt.choices?.find(c => String(c.value) === e.target.value);
              onChange(chosen ? chosen.value : e.target.value);
            }}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1 bg-white text-gray-700"
          >
            {(opt.choices ?? []).map(choice => (
              <option key={String(choice.value)} value={String(choice.value)}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
      );

    case 'number':
      return (
        <div>
          <label className="block text-xs text-gray-600 mb-1">{opt.label}</label>
          <input
            type="number"
            value={value as number}
            min={opt.min}
            max={opt.max}
            step={opt.step ?? 1}
            onChange={e => onChange(Number(e.target.value))}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1 text-gray-700"
          />
        </div>
      );

    default:
      return null;
  }
}
