import { useState } from 'react';
import { JamoviStyleDialog } from '../../components/analysis/JamoviStyleDialog';
import { moderationSpec } from '@method-studio/analysis-specs';
import type { AnalysisRequest } from '@method-studio/analysis-specs';
import type { Variable } from '../../types/data.ts';

interface ModerationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRun: (request: AnalysisRequest) => void;
  variables: Variable[];
  datasetName: string;
  isRunning?: boolean;
}

/**
 * Moderation Analysis dialog (PROCESS Model 1).
 * Uses JamoviStyleDialog with drag-and-drop support.
 */
export function ModerationDialog({
  isOpen,
  onClose,
  onRun,
  variables,
  datasetName,
  isRunning = false,
}: ModerationDialogProps) {
  // Map dataset Variable type to the simplified format JamoviStyleDialog expects
  const availableVariables = variables.map(v => ({
    name: v.name,
    type: v.type as 'numeric' | 'string' | 'date',
    label: v.label,
  }));

  return (
    <JamoviStyleDialog
      spec={moderationSpec}
      datasetName={datasetName}
      availableVariables={availableVariables}
      isOpen={isOpen}
      onClose={onClose}
      onRun={onRun}
      isRunning={isRunning}
    />
  );
}

// ---------------------------------------------------------------------------
// useModerationDialog hook
// ---------------------------------------------------------------------------

export function useModerationDialog() {
  const [isOpen, setIsOpen] = useState(false);
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}
