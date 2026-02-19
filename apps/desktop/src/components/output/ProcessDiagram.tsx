import { useState, useId, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessDiagramProps {
  modelType: 'mediation' | 'moderation' | 'moderated-mediation' | 'serial-mediation' | 'model-8' | 'model-58' | 'model-59';
  variables: {
    x?: string;  // Predictor
    y?: string;  // Outcome
    m?: string;  // Mediator
    m1?: string; // First mediator (serial)
    m2?: string; // Second mediator (serial)
    w?: string;  // Moderator
  };
  coefficients?: {
    a?: number;          // X → M path
    a1?: number;         // X → M1 path (serial)
    a2?: number;         // M1 → M2 path (serial)
    b?: number;          // M → Y path
    b1?: number;         // M1 → Y path (serial)
    b2?: number;         // M2 → Y path (serial)
    c?: number;          // Total effect
    cPrime?: number;     // Direct effect
    interaction?: number; // X*W interaction
  };
  pValues?: Record<string, number>;
  confidence?: Record<string, [number, number]>; // Bootstrap CIs
  width?: number;
  height?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSigStars(p: number | undefined): string {
  if (p === undefined) return '';
  if (p < 0.001) return '***';
  if (p < 0.01) return '**';
  if (p < 0.05) return '*';
  return '';
}

function formatCoef(n: number | undefined): string {
  if (n === undefined) return '';
  return n.toFixed(3).replace(/^-0\./, '-.').replace(/^0\./, '.');
}

// Truncate variable labels that would overflow boxes
function truncLabel(label: string | undefined, maxLen = 10): string {
  if (!label) return '?';
  return label.length > maxLen ? label.slice(0, maxLen - 1) + '\u2026' : label;
}

// ---------------------------------------------------------------------------
// Reusable SVG sub-components
// ---------------------------------------------------------------------------

interface BoxProps {
  cx: number;
  cy: number;
  w: number;
  h: number;
  label: string;
  sublabel?: string;
  id?: string;
}

function Box({ cx, cy, w, h, label, sublabel }: BoxProps) {
  return (
    <g>
      <rect
        x={cx - w / 2}
        y={cy - h / 2}
        width={w}
        height={h}
        rx={4}
        ry={4}
        fill="var(--color-surface)"
        stroke="var(--color-border-strong)"
        strokeWidth={1.5}
      />
      <text
        x={cx}
        y={cy + (sublabel ? -5 : 1)}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={11}
        fontFamily="'IBM Plex Sans', sans-serif"
        fontWeight={600}
        fill="var(--color-text-primary)"
      >
        {label}
      </text>
      {sublabel && (
        <text
          x={cx}
          y={cy + 10}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={9}
          fontFamily="'IBM Plex Sans', sans-serif"
          fill="var(--color-text-tertiary)"
        >
          {sublabel}
        </text>
      )}
    </g>
  );
}

interface ArrowProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  sigStars?: string;
  markerId: string;
  dashed?: boolean;
  curveOffset?: number; // positive = arc above, negative = arc below
  ciLabel?: string;
  labelOffsetX?: number; // manual X offset for label
  labelOffsetY?: number; // manual Y offset for label (negative = above line)
}

function Arrow({
  x1,
  y1,
  x2,
  y2,
  label,
  sigStars,
  markerId,
  dashed,
  curveOffset,
  ciLabel,
  labelOffsetX = 0,
  labelOffsetY = -12,
}: ArrowProps) {
  const [hovered, setHovered] = useState(false);

  // Midpoint for label placement
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  // Calculate angle for diagonal lines to offset label perpendicular to path
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const perpAngle = angle - Math.PI / 2; // perpendicular angle

  // Path string
  let pathD: string;
  let labelX = mx;
  let labelY = my;

  if (curveOffset) {
    // Quadratic bezier curve
    const cpx = mx;
    const cpy = my + curveOffset;
    pathD = `M ${x1} ${y1} Q ${cpx} ${cpy} ${x2} ${y2}`;
    labelX = mx;
    labelY = cpy + (curveOffset > 0 ? 14 : -14);
  } else {
    pathD = `M ${x1} ${y1} L ${x2} ${y2}`;
    // For diagonal lines, offset perpendicular to the line
    const offsetDist = Math.abs(labelOffsetY);
    labelX = mx + Math.cos(perpAngle) * offsetDist + labelOffsetX;
    labelY = my + Math.sin(perpAngle) * offsetDist;
  }

  const displayLabel = label
    ? sigStars
      ? `${label}${sigStars}`
      : label
    : sigStars || '';

  // Estimate label width for background
  const labelWidth = displayLabel.length * 6 + 8;
  const labelHeight = 14;

  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ cursor: ciLabel ? 'help' : 'default' }}
    >
      <path
        d={pathD}
        fill="none"
        stroke={hovered ? 'var(--color-accent)' : 'var(--color-text-secondary)'}
        strokeWidth={1.5}
        strokeDasharray={dashed ? '5 3' : undefined}
        markerEnd={`url(#${markerId})`}
        style={{ transition: 'stroke 0.15s ease' }}
      />
      {displayLabel && (
        <>
          {/* White background for label to prevent overlap */}
          <rect
            x={labelX - labelWidth / 2}
            y={labelY - labelHeight / 2 - 2}
            width={labelWidth}
            height={labelHeight}
            fill="var(--color-surface, white)"
            rx={2}
          />
          <text
            x={labelX}
            y={labelY}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={10}
            fontFamily="'IBM Plex Sans', sans-serif"
            fontStyle="italic"
            fill={hovered ? 'var(--color-accent)' : 'var(--color-text-secondary)'}
            style={{ transition: 'fill 0.15s ease' }}
          >
            {displayLabel}
          </text>
        </>
      )}
      {/* Tooltip for CI */}
      {hovered && ciLabel && (
        <g>
          <rect
            x={labelX - 60}
            y={labelY - 32}
            width={120}
            height={18}
            rx={3}
            fill="var(--color-surface)"
            stroke="var(--color-border)"
            strokeWidth={1}
            filter="drop-shadow(0 2px 4px rgba(0,0,0,0.15))"
          />
          <text
            x={labelX}
            y={labelY - 22}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={9}
            fontFamily="'IBM Plex Sans', sans-serif"
            fill="var(--color-text-primary)"
          >
            {ciLabel}
          </text>
        </g>
      )}
    </g>
  );
}

// Arrowhead marker definition
function ArrowMarker({ id, color = 'var(--color-text-secondary)' }: { id: string; color?: string }) {
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX={9}
      refY={5}
      markerWidth={6}
      markerHeight={6}
      orient="auto-start-reverse"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
    </marker>
  );
}

// ---------------------------------------------------------------------------
// Model renderers
// ---------------------------------------------------------------------------

/** Model 4: Simple Mediation - Triangle layout
 *         M (top center)
 *        / \
 *       a   b
 *      /     \
 *     X --c'-- Y (bottom)
 */
function MediationDiagram({
  vars,
  coef,
  pVals,
  conf,
  w,
  h,
}: {
  vars: ProcessDiagramProps['variables'];
  coef: ProcessDiagramProps['coefficients'];
  pVals: ProcessDiagramProps['pValues'];
  conf: ProcessDiagramProps['confidence'];
  w: number;
  h: number;
}) {
  const uid = useId().replace(/:/g, '');

  // Layout constants
  const BOX_W = 100;
  const BOX_H = 44;
  const PAD_X = 50;

  // Triangle layout: M at top center, X bottom left, Y bottom right
  const xX = PAD_X + BOX_W / 2;           // X position (left)
  const xM = w / 2;                        // M position (center)
  const xY = w - PAD_X - BOX_W / 2;       // Y position (right)
  const yTop = h * 0.22;                   // M row (top)
  const yBottom = h * 0.68;                // X, Y row (bottom)

  const aStars = getSigStars(pVals?.['a']);
  const bStars = getSigStars(pVals?.['b']);
  const cpStars = getSigStars(pVals?.['cPrime']);

  const aCi = conf?.['a'] ? `95% CI [${conf['a'][0].toFixed(3)}, ${conf['a'][1].toFixed(3)}]` : undefined;
  const bCi = conf?.['b'] ? `95% CI [${conf['b'][0].toFixed(3)}, ${conf['b'][1].toFixed(3)}]` : undefined;
  const cpCi = conf?.['cPrime'] ? `95% CI [${conf['cPrime'][0].toFixed(3)}, ${conf['cPrime'][1].toFixed(3)}]` : undefined;

  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }} aria-label="Mediation path diagram">
      <defs>
        <ArrowMarker id={`${uid}-arrow`} />
      </defs>

      {/* X → M (a path) - diagonal up-right */}
      <Arrow
        x1={xX + BOX_W / 2} y1={yBottom - BOX_H / 2 + 4}
        x2={xM - BOX_W / 2} y2={yTop + BOX_H / 2 - 4}
        label={coef?.a !== undefined ? `a = ${formatCoef(coef.a)}` : 'a'}
        sigStars={aStars}
        markerId={`${uid}-arrow`}
        ciLabel={aCi}
      />

      {/* M → Y (b path) - diagonal down-right */}
      <Arrow
        x1={xM + BOX_W / 2} y1={yTop + BOX_H / 2 - 4}
        x2={xY - BOX_W / 2} y2={yBottom - BOX_H / 2 + 4}
        label={coef?.b !== undefined ? `b = ${formatCoef(coef.b)}` : 'b'}
        sigStars={bStars}
        markerId={`${uid}-arrow`}
        ciLabel={bCi}
      />

      {/* X → Y (c' direct path) - horizontal bottom */}
      <Arrow
        x1={xX + BOX_W / 2} y1={yBottom}
        x2={xY - BOX_W / 2} y2={yBottom}
        label={coef?.cPrime !== undefined ? `c\u2032 = ${formatCoef(coef.cPrime)}` : "c\u2032"}
        sigStars={cpStars}
        markerId={`${uid}-arrow`}
        ciLabel={cpCi}
      />

      {/* Boxes - Triangle: M top, X bottom-left, Y bottom-right */}
      <Box cx={xM} cy={yTop} w={BOX_W} h={BOX_H} label={truncLabel(vars.m)} sublabel="Mediator (M)" />
      <Box cx={xX} cy={yBottom} w={BOX_W} h={BOX_H} label={truncLabel(vars.x)} sublabel="Predictor (X)" />
      <Box cx={xY} cy={yBottom} w={BOX_W} h={BOX_H} label={truncLabel(vars.y)} sublabel="Outcome (Y)" />

      {/* Total effect annotation */}
      {coef?.c !== undefined && (
        <text
          x={w / 2}
          y={h - 8}
          textAnchor="middle"
          fontSize={10}
          fontFamily="'IBM Plex Sans', sans-serif"
          fill="var(--color-text-tertiary)"
        >
          Total effect c = {formatCoef(coef.c)}{getSigStars(pVals?.['c'])}
        </text>
      )}
    </svg>
  );
}

/** Model 1: Simple Moderation  X → Y, W moderates */
function ModerationDiagram({
  vars,
  coef,
  pVals,
  conf,
  w,
  h,
}: {
  vars: ProcessDiagramProps['variables'];
  coef: ProcessDiagramProps['coefficients'];
  pVals: ProcessDiagramProps['pValues'];
  conf: ProcessDiagramProps['confidence'];
  w: number;
  h: number;
}) {
  const uid = useId().replace(/:/g, '');

  const BOX_W = 88;
  const BOX_H = 36;
  const PAD_X = 60;

  const xX = PAD_X + BOX_W / 2;
  const xY = w - PAD_X - BOX_W / 2;
  const yMid = h / 2;
  const yW = h * 0.15;

  // Interaction point on X→Y arrow
  const intX = w / 2;

  const cStars = getSigStars(pVals?.['c']);
  const intStars = getSigStars(pVals?.['interaction']);
  const cCi = conf?.['c'] ? `95% CI [${conf['c'][0].toFixed(3)}, ${conf['c'][1].toFixed(3)}]` : undefined;
  const intCi = conf?.['interaction']
    ? `95% CI [${conf['interaction'][0].toFixed(3)}, ${conf['interaction'][1].toFixed(3)}]`
    : undefined;

  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }} aria-label="Moderation path diagram">
      <defs>
        <ArrowMarker id={`${uid}-arrow`} />
      </defs>

      {/* X → Y (c path) */}
      <Arrow
        x1={xX + BOX_W / 2} y1={yMid}
        x2={xY - BOX_W / 2} y2={yMid}
        label={coef?.c !== undefined ? `c = ${formatCoef(coef.c)}` : 'c'}
        sigStars={cStars}
        markerId={`${uid}-arrow`}
        ciLabel={cCi}
      />

      {/* W → interaction point (moderator arrow) */}
      <Arrow
        x1={intX} y1={yW + BOX_H / 2}
        x2={intX} y2={yMid - 4}
        label={coef?.interaction !== undefined ? `${formatCoef(coef.interaction)}` : ''}
        sigStars={intStars}
        markerId={`${uid}-arrow`}
        ciLabel={intCi}
      />

      {/* Intersection tick mark */}
      <line
        x1={intX - 6} y1={yMid}
        x2={intX + 6} y2={yMid}
        stroke="var(--color-text-secondary)"
        strokeWidth={2}
      />

      {/* Boxes */}
      <Box cx={xX} cy={yMid} w={BOX_W} h={BOX_H} label={truncLabel(vars.x)} sublabel="Predictor (X)" />
      <Box cx={xY} cy={yMid} w={BOX_W} h={BOX_H} label={truncLabel(vars.y)} sublabel="Outcome (Y)" />
      <Box cx={intX} cy={yW} w={BOX_W} h={BOX_H} label={truncLabel(vars.w)} sublabel="Moderator (W)" />

      {/* X*W label near intersection */}
      <text
        x={intX + 10}
        y={yMid - 10}
        fontSize={9}
        fontFamily="'IBM Plex Sans', sans-serif"
        fill="var(--color-text-tertiary)"
      >
        X\u00d7W
      </text>
    </svg>
  );
}

/** Model 7 / 14: Moderated Mediation  X → M → Y with W moderating a-path or b-path */
function ModeratedMediationDiagram({
  vars,
  coef,
  pVals,
  conf,
  w,
  h,
}: {
  vars: ProcessDiagramProps['variables'];
  coef: ProcessDiagramProps['coefficients'];
  pVals: ProcessDiagramProps['pValues'];
  conf: ProcessDiagramProps['confidence'];
  w: number;
  h: number;
}) {
  const uid = useId().replace(/:/g, '');

  const BOX_W = 88;
  const BOX_H = 36;
  const PAD_X = 52;

  const xX = PAD_X + BOX_W / 2;
  const xM = w / 2;
  const xY = w - PAD_X - BOX_W / 2;
  const yCenterRow = h * 0.58;
  const yTopRow = h * 0.18;

  // Arrow edge coordinates
  const xRight = xX + BOX_W / 2;
  const mLeft = xM - BOX_W / 2;
  const mRight = xM + BOX_W / 2;
  const yLeft = xY - BOX_W / 2;

  // Interaction point on a-path (X→M)
  const aIntX = (xRight + mLeft) / 2;

  const aStars = getSigStars(pVals?.['a']);
  const bStars = getSigStars(pVals?.['b']);
  const cpStars = getSigStars(pVals?.['cPrime']);
  const intStars = getSigStars(pVals?.['interaction']);

  const aCi = conf?.['a'] ? `95% CI [${conf['a'][0].toFixed(3)}, ${conf['a'][1].toFixed(3)}]` : undefined;
  const bCi = conf?.['b'] ? `95% CI [${conf['b'][0].toFixed(3)}, ${conf['b'][1].toFixed(3)}]` : undefined;
  const cpCi = conf?.['cPrime'] ? `95% CI [${conf['cPrime'][0].toFixed(3)}, ${conf['cPrime'][1].toFixed(3)}]` : undefined;

  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }} aria-label="Moderated mediation path diagram">
      <defs>
        <ArrowMarker id={`${uid}-arrow`} />
      </defs>

      {/* X → M (a path) */}
      <Arrow
        x1={xRight} y1={yCenterRow}
        x2={mLeft} y2={yCenterRow}
        label={coef?.a !== undefined ? `a = ${formatCoef(coef.a)}` : 'a'}
        sigStars={aStars}
        markerId={`${uid}-arrow`}
        ciLabel={aCi}
      />

      {/* M → Y (b path) */}
      <Arrow
        x1={mRight} y1={yCenterRow}
        x2={yLeft} y2={yCenterRow}
        label={coef?.b !== undefined ? `b = ${formatCoef(coef.b)}` : 'b'}
        sigStars={bStars}
        markerId={`${uid}-arrow`}
        ciLabel={bCi}
      />

      {/* X → Y direct (c' path) — curved below */}
      <Arrow
        x1={xX + BOX_W / 2} y1={yCenterRow + BOX_H / 2 - 4}
        x2={xY - BOX_W / 2} y2={yCenterRow + BOX_H / 2 - 4}
        label={coef?.cPrime !== undefined ? `c\u2032 = ${formatCoef(coef.cPrime)}` : "c\u2032"}
        sigStars={cpStars}
        markerId={`${uid}-arrow`}
        curveOffset={38}
        ciLabel={cpCi}
      />

      {/* W → a-path intersection */}
      <Arrow
        x1={aIntX} y1={yTopRow + BOX_H / 2}
        x2={aIntX} y2={yCenterRow - 4}
        label={coef?.interaction !== undefined ? formatCoef(coef.interaction) : ''}
        sigStars={intStars}
        markerId={`${uid}-arrow`}
      />

      {/* Intersection tick on a-path */}
      <line
        x1={aIntX - 6} y1={yCenterRow}
        x2={aIntX + 6} y2={yCenterRow}
        stroke="var(--color-text-secondary)"
        strokeWidth={2}
      />

      {/* Boxes */}
      <Box cx={xX} cy={yCenterRow} w={BOX_W} h={BOX_H} label={truncLabel(vars.x)} sublabel="Predictor (X)" />
      <Box cx={xM} cy={yCenterRow} w={BOX_W} h={BOX_H} label={truncLabel(vars.m)} sublabel="Mediator (M)" />
      <Box cx={xY} cy={yCenterRow} w={BOX_W} h={BOX_H} label={truncLabel(vars.y)} sublabel="Outcome (Y)" />
      <Box cx={aIntX} cy={yTopRow} w={BOX_W} h={BOX_H} label={truncLabel(vars.w)} sublabel="Moderator (W)" />
    </svg>
  );
}

/** Model 6: Serial Mediation  X → M1 → M2 → Y */
function SerialMediationDiagram({
  vars,
  coef,
  pVals,
  conf,
  w,
  h,
}: {
  vars: ProcessDiagramProps['variables'];
  coef: ProcessDiagramProps['coefficients'];
  pVals: ProcessDiagramProps['pValues'];
  conf: ProcessDiagramProps['confidence'];
  w: number;
  h: number;
}) {
  const uid = useId().replace(/:/g, '');

  const BOX_W = 82;
  const BOX_H = 34;
  const PAD_X = 36;

  // Four columns: X, M1, M2, Y
  const usableW = w - 2 * PAD_X - 4 * BOX_W;
  const gap = usableW / 3;

  const xX  = PAD_X + BOX_W / 2;
  const xM1 = xX + BOX_W + gap;
  const xM2 = xM1 + BOX_W + gap;
  const xY  = xM2 + BOX_W + gap;

  const yTop = h * 0.27;
  const yBot = h * 0.68;

  const a1Stars = getSigStars(pVals?.['a1']);
  const a2Stars = getSigStars(pVals?.['a2']);
  const b1Stars = getSigStars(pVals?.['b1']);
  const b2Stars = getSigStars(pVals?.['b2']);
  const cpStars = getSigStars(pVals?.['cPrime']);

  const a1Ci = conf?.['a1'] ? `95% CI [${conf['a1'][0].toFixed(3)}, ${conf['a1'][1].toFixed(3)}]` : undefined;
  const a2Ci = conf?.['a2'] ? `95% CI [${conf['a2'][0].toFixed(3)}, ${conf['a2'][1].toFixed(3)}]` : undefined;
  const b1Ci = conf?.['b1'] ? `95% CI [${conf['b1'][0].toFixed(3)}, ${conf['b1'][1].toFixed(3)}]` : undefined;
  const b2Ci = conf?.['b2'] ? `95% CI [${conf['b2'][0].toFixed(3)}, ${conf['b2'][1].toFixed(3)}]` : undefined;
  const cpCi = conf?.['cPrime'] ? `95% CI [${conf['cPrime'][0].toFixed(3)}, ${conf['cPrime'][1].toFixed(3)}]` : undefined;

  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }} aria-label="Serial mediation path diagram">
      <defs>
        <ArrowMarker id={`${uid}-arrow`} />
      </defs>

      {/* Top row: X → M1 → M2 → Y (a1, a2, b2) */}
      <Arrow
        x1={xX + BOX_W / 2}  y1={yTop}
        x2={xM1 - BOX_W / 2} y2={yTop}
        label={coef?.a1 !== undefined ? `a\u2081 = ${formatCoef(coef.a1)}` : 'a\u2081'}
        sigStars={a1Stars}
        markerId={`${uid}-arrow`}
        ciLabel={a1Ci}
      />
      <Arrow
        x1={xM1 + BOX_W / 2} y1={yTop}
        x2={xM2 - BOX_W / 2} y2={yTop}
        label={coef?.a2 !== undefined ? `a\u2082 = ${formatCoef(coef.a2)}` : 'd\u2082\u2081'}
        sigStars={a2Stars}
        markerId={`${uid}-arrow`}
        ciLabel={a2Ci}
      />
      <Arrow
        x1={xM2 + BOX_W / 2} y1={yTop}
        x2={xY - BOX_W / 2}  y2={yTop}
        label={coef?.b2 !== undefined ? `b\u2082 = ${formatCoef(coef.b2)}` : 'b\u2082'}
        sigStars={b2Stars}
        markerId={`${uid}-arrow`}
        ciLabel={b2Ci}
      />

      {/* M1 → Y (b1) — diagonal */}
      <Arrow
        x1={xM1 + BOX_W / 2} y1={yTop + BOX_H / 2}
        x2={xY - BOX_W / 2}  y2={yBot - BOX_H / 2}
        label={coef?.b1 !== undefined ? `b\u2081 = ${formatCoef(coef.b1)}` : 'b\u2081'}
        sigStars={b1Stars}
        markerId={`${uid}-arrow`}
        ciLabel={b1Ci}
      />

      {/* X → Y direct (c' path) — bottom row */}
      <Arrow
        x1={xX + BOX_W / 2} y1={yBot}
        x2={xY - BOX_W / 2} y2={yBot}
        label={coef?.cPrime !== undefined ? `c\u2032 = ${formatCoef(coef.cPrime)}` : "c\u2032"}
        sigStars={cpStars}
        markerId={`${uid}-arrow`}
        ciLabel={cpCi}
      />

      {/* Vertical connector X top to X bottom */}
      <line
        x1={xX} y1={yTop + BOX_H / 2}
        x2={xX} y2={yBot - BOX_H / 2}
        stroke="var(--color-border)"
        strokeWidth={1}
        strokeDasharray="3 2"
      />
      {/* Vertical connector Y top to Y bottom */}
      <line
        x1={xY} y1={yTop + BOX_H / 2}
        x2={xY} y2={yBot - BOX_H / 2}
        stroke="var(--color-border)"
        strokeWidth={1}
        strokeDasharray="3 2"
      />

      {/* Boxes — top row */}
      <Box cx={xX}  cy={yTop} w={BOX_W} h={BOX_H} label={truncLabel(vars.x)}  sublabel="X" />
      <Box cx={xM1} cy={yTop} w={BOX_W} h={BOX_H} label={truncLabel(vars.m1)} sublabel="M\u2081" />
      <Box cx={xM2} cy={yTop} w={BOX_W} h={BOX_H} label={truncLabel(vars.m2)} sublabel="M\u2082" />
      <Box cx={xY}  cy={yTop} w={BOX_W} h={BOX_H} label={truncLabel(vars.y)}  sublabel="Y" />

      {/* Boxes — bottom row (X repeat and Y repeat for c' path clarity) */}
      <Box cx={xX} cy={yBot} w={BOX_W} h={BOX_H} label={truncLabel(vars.x)} sublabel="X" />
      <Box cx={xY} cy={yBot} w={BOX_W} h={BOX_H} label={truncLabel(vars.y)} sublabel="Y" />
    </svg>
  );
}

/** Model 8: W moderates BOTH a-path (X→M) AND c'-path (X→Y)
 *         M (top center)
 *        ↗   ↘
 *       a     b
 *      ↗       ↘
 *     X ---c'--- Y
 *      ↖
 *       W (bottom left area) → tick on a-path and c'-path
 */
function Model8Diagram({
  vars,
  coef,
  pVals,
  conf,
  w,
  h,
}: {
  vars: ProcessDiagramProps['variables'];
  coef: ProcessDiagramProps['coefficients'];
  pVals: ProcessDiagramProps['pValues'];
  conf: ProcessDiagramProps['confidence'];
  w: number;
  h: number;
}) {
  const uid = useId().replace(/:/g, '');

  const BOX_W = 96;
  const BOX_H = 38;
  const PAD_X = 52;

  // Triangle: M top-center, X bottom-left, Y bottom-right
  const xX = PAD_X + BOX_W / 2;
  const xM = w / 2;
  const xY = w - PAD_X - BOX_W / 2;
  const yTop = h * 0.18;
  const yBottom = h * 0.62;

  // W box: below and left of center
  const xW = xX + 10;
  const yW = h * 0.88;

  // Midpoints of a-path and c'-path for tick marks
  const aPathMidX = (xX + BOX_W / 2 + (xM - BOX_W / 2)) / 2;
  const aPathMidY = (yBottom - BOX_H / 2 + yTop + BOX_H / 2) / 2;
  const cPathMidX = (xX + BOX_W / 2 + (xY - BOX_W / 2)) / 2;
  const cPathMidY = yBottom;

  // Angle of a-path for tick rotation
  const aDx = (xM - BOX_W / 2) - (xX + BOX_W / 2);
  const aDy = (yTop + BOX_H / 2) - (yBottom - BOX_H / 2);
  const aAngle = Math.atan2(aDy, aDx) * (180 / Math.PI);

  const aStars = getSigStars(pVals?.['a']);
  const bStars = getSigStars(pVals?.['b']);
  const cpStars = getSigStars(pVals?.['cPrime']);
  const intStars = getSigStars(pVals?.['interaction']);

  const aCi = conf?.['a'] ? `95% CI [${conf['a'][0].toFixed(3)}, ${conf['a'][1].toFixed(3)}]` : undefined;
  const bCi = conf?.['b'] ? `95% CI [${conf['b'][0].toFixed(3)}, ${conf['b'][1].toFixed(3)}]` : undefined;
  const cpCi = conf?.['cPrime'] ? `95% CI [${conf['cPrime'][0].toFixed(3)}, ${conf['cPrime'][1].toFixed(3)}]` : undefined;

  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }} aria-label="Model 8 conditional process diagram">
      <defs>
        <ArrowMarker id={`${uid}-arrow`} />
      </defs>

      {/* X → M (a path) */}
      <Arrow
        x1={xX + BOX_W / 2} y1={yBottom - BOX_H / 2 + 4}
        x2={xM - BOX_W / 2} y2={yTop + BOX_H / 2 - 4}
        label={coef?.a !== undefined ? `a = ${formatCoef(coef.a)}` : 'a'}
        sigStars={aStars}
        markerId={`${uid}-arrow`}
        ciLabel={aCi}
      />

      {/* M → Y (b path) */}
      <Arrow
        x1={xM + BOX_W / 2} y1={yTop + BOX_H / 2 - 4}
        x2={xY - BOX_W / 2} y2={yBottom - BOX_H / 2 + 4}
        label={coef?.b !== undefined ? `b = ${formatCoef(coef.b)}` : 'b'}
        sigStars={bStars}
        markerId={`${uid}-arrow`}
        ciLabel={bCi}
      />

      {/* X → Y (c' direct path) */}
      <Arrow
        x1={xX + BOX_W / 2} y1={yBottom}
        x2={xY - BOX_W / 2} y2={yBottom}
        label={coef?.cPrime !== undefined ? `c\u2032 = ${formatCoef(coef.cPrime)}` : "c\u2032"}
        sigStars={cpStars}
        markerId={`${uid}-arrow`}
        ciLabel={cpCi}
      />

      {/* W → a-path tick */}
      <line
        x1={xW + BOX_W / 2} y1={yW - BOX_H / 2}
        x2={aPathMidX} y2={aPathMidY}
        stroke="var(--color-text-secondary)"
        strokeWidth={1.5}
        markerEnd={`url(#${uid}-arrow)`}
      />
      {coef?.interaction !== undefined && (
        <text
          x={(xW + BOX_W / 2 + aPathMidX) / 2 - 14}
          y={(yW - BOX_H / 2 + aPathMidY) / 2}
          fontSize={10}
          fontFamily="'IBM Plex Sans', sans-serif"
          fontStyle="italic"
          fill="var(--color-text-secondary)"
          textAnchor="middle"
        >
          {formatCoef(coef.interaction)}{intStars}
        </text>
      )}

      {/* W → c'-path tick (second arrow, slightly offset) */}
      <line
        x1={xW + BOX_W / 2 + 6} y1={yW - BOX_H / 2}
        x2={cPathMidX} y2={cPathMidY + 10}
        stroke="var(--color-text-secondary)"
        strokeWidth={1.5}
        strokeDasharray="4 2"
        markerEnd={`url(#${uid}-arrow)`}
      />

      {/* Tick on a-path */}
      <g transform={`translate(${aPathMidX}, ${aPathMidY}) rotate(${aAngle})`}>
        <line x1={0} y1={-7} x2={0} y2={7} stroke="var(--color-text-secondary)" strokeWidth={2} />
      </g>

      {/* Tick on c'-path */}
      <line
        x1={cPathMidX} y1={cPathMidY - 6}
        x2={cPathMidX} y2={cPathMidY + 6}
        stroke="var(--color-text-secondary)"
        strokeWidth={2}
      />

      {/* Boxes */}
      <Box cx={xM} cy={yTop} w={BOX_W} h={BOX_H} label={truncLabel(vars.m)} sublabel="Mediator (M)" />
      <Box cx={xX} cy={yBottom} w={BOX_W} h={BOX_H} label={truncLabel(vars.x)} sublabel="Predictor (X)" />
      <Box cx={xY} cy={yBottom} w={BOX_W} h={BOX_H} label={truncLabel(vars.y)} sublabel="Outcome (Y)" />
      <Box cx={xW} cy={yW} w={BOX_W} h={BOX_H} label={truncLabel(vars.w)} sublabel="Moderator (W)" />
    </svg>
  );
}

/** Model 58: W moderates BOTH a-path (X→M) AND b-path (M→Y)
 *         M (top center)
 *        ↗   ↘
 *       a     b
 *      ↗       ↘
 *     X ---c'--- Y
 *              ↑
 *              W (right side) → tick on a-path and b-path
 */
function Model58Diagram({
  vars,
  coef,
  pVals,
  conf,
  w,
  h,
}: {
  vars: ProcessDiagramProps['variables'];
  coef: ProcessDiagramProps['coefficients'];
  pVals: ProcessDiagramProps['pValues'];
  conf: ProcessDiagramProps['confidence'];
  w: number;
  h: number;
}) {
  const uid = useId().replace(/:/g, '');

  const BOX_W = 96;
  const BOX_H = 38;
  const PAD_X = 52;

  const xX = PAD_X + BOX_W / 2;
  const xM = w / 2;
  const xY = w - PAD_X - BOX_W / 2;
  const yTop = h * 0.18;
  const yBottom = h * 0.62;

  // W positioned upper-right
  const xW = xY - 10;
  const yW = h * 0.88;

  // Midpoints
  const aPathMidX = (xX + BOX_W / 2 + (xM - BOX_W / 2)) / 2;
  const aPathMidY = (yBottom - BOX_H / 2 + yTop + BOX_H / 2) / 2;
  const bPathMidX = (xM + BOX_W / 2 + (xY - BOX_W / 2)) / 2;
  const bPathMidY = (yTop + BOX_H / 2 + yBottom - BOX_H / 2) / 2;

  // Angle of a-path
  const aDx = (xM - BOX_W / 2) - (xX + BOX_W / 2);
  const aDy = (yTop + BOX_H / 2) - (yBottom - BOX_H / 2);
  const aAngle = Math.atan2(aDy, aDx) * (180 / Math.PI);

  // Angle of b-path
  const bDx = (xY - BOX_W / 2) - (xM + BOX_W / 2);
  const bDy = (yBottom - BOX_H / 2) - (yTop + BOX_H / 2);
  const bAngle = Math.atan2(bDy, bDx) * (180 / Math.PI);

  const aStars = getSigStars(pVals?.['a']);
  const bStars = getSigStars(pVals?.['b']);
  const cpStars = getSigStars(pVals?.['cPrime']);
  const intStars = getSigStars(pVals?.['interaction']);

  const aCi = conf?.['a'] ? `95% CI [${conf['a'][0].toFixed(3)}, ${conf['a'][1].toFixed(3)}]` : undefined;
  const bCi = conf?.['b'] ? `95% CI [${conf['b'][0].toFixed(3)}, ${conf['b'][1].toFixed(3)}]` : undefined;
  const cpCi = conf?.['cPrime'] ? `95% CI [${conf['cPrime'][0].toFixed(3)}, ${conf['cPrime'][1].toFixed(3)}]` : undefined;

  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }} aria-label="Model 58 conditional process diagram">
      <defs>
        <ArrowMarker id={`${uid}-arrow`} />
      </defs>

      {/* X → M (a path) */}
      <Arrow
        x1={xX + BOX_W / 2} y1={yBottom - BOX_H / 2 + 4}
        x2={xM - BOX_W / 2} y2={yTop + BOX_H / 2 - 4}
        label={coef?.a !== undefined ? `a = ${formatCoef(coef.a)}` : 'a'}
        sigStars={aStars}
        markerId={`${uid}-arrow`}
        ciLabel={aCi}
      />

      {/* M → Y (b path) */}
      <Arrow
        x1={xM + BOX_W / 2} y1={yTop + BOX_H / 2 - 4}
        x2={xY - BOX_W / 2} y2={yBottom - BOX_H / 2 + 4}
        label={coef?.b !== undefined ? `b = ${formatCoef(coef.b)}` : 'b'}
        sigStars={bStars}
        markerId={`${uid}-arrow`}
        ciLabel={bCi}
      />

      {/* X → Y (c' direct path) */}
      <Arrow
        x1={xX + BOX_W / 2} y1={yBottom}
        x2={xY - BOX_W / 2} y2={yBottom}
        label={coef?.cPrime !== undefined ? `c\u2032 = ${formatCoef(coef.cPrime)}` : "c\u2032"}
        sigStars={cpStars}
        markerId={`${uid}-arrow`}
        ciLabel={cpCi}
      />

      {/* W → a-path */}
      <line
        x1={xW - BOX_W / 2} y1={yW - BOX_H / 2}
        x2={aPathMidX} y2={aPathMidY}
        stroke="var(--color-text-secondary)"
        strokeWidth={1.5}
        markerEnd={`url(#${uid}-arrow)`}
      />

      {/* W → b-path */}
      <line
        x1={xW - BOX_W / 2 - 6} y1={yW - BOX_H / 2}
        x2={bPathMidX} y2={bPathMidY}
        stroke="var(--color-text-secondary)"
        strokeWidth={1.5}
        strokeDasharray="4 2"
        markerEnd={`url(#${uid}-arrow)`}
      />

      {coef?.interaction !== undefined && (
        <text
          x={(xW - BOX_W / 2 + bPathMidX) / 2 + 8}
          y={(yW - BOX_H / 2 + bPathMidY) / 2}
          fontSize={10}
          fontFamily="'IBM Plex Sans', sans-serif"
          fontStyle="italic"
          fill="var(--color-text-secondary)"
          textAnchor="middle"
        >
          {formatCoef(coef.interaction)}{intStars}
        </text>
      )}

      {/* Tick on a-path */}
      <g transform={`translate(${aPathMidX}, ${aPathMidY}) rotate(${aAngle})`}>
        <line x1={0} y1={-7} x2={0} y2={7} stroke="var(--color-text-secondary)" strokeWidth={2} />
      </g>

      {/* Tick on b-path */}
      <g transform={`translate(${bPathMidX}, ${bPathMidY}) rotate(${bAngle})`}>
        <line x1={0} y1={-7} x2={0} y2={7} stroke="var(--color-text-secondary)" strokeWidth={2} />
      </g>

      {/* Boxes */}
      <Box cx={xM} cy={yTop} w={BOX_W} h={BOX_H} label={truncLabel(vars.m)} sublabel="Mediator (M)" />
      <Box cx={xX} cy={yBottom} w={BOX_W} h={BOX_H} label={truncLabel(vars.x)} sublabel="Predictor (X)" />
      <Box cx={xY} cy={yBottom} w={BOX_W} h={BOX_H} label={truncLabel(vars.y)} sublabel="Outcome (Y)" />
      <Box cx={xW} cy={yW} w={BOX_W} h={BOX_H} label={truncLabel(vars.w)} sublabel="Moderator (W)" />
    </svg>
  );
}

/** Model 59: W moderates ALL THREE paths (a, b, and c')
 *         M (top center)
 *        ↗   ↘
 *       a     b
 *      ↗       ↘
 *     X ---c'--- Y
 *         ↑
 *         W (bottom center) → ticks on a-path, b-path, AND c'-path
 */
function Model59Diagram({
  vars,
  coef,
  pVals,
  conf,
  w,
  h,
}: {
  vars: ProcessDiagramProps['variables'];
  coef: ProcessDiagramProps['coefficients'];
  pVals: ProcessDiagramProps['pValues'];
  conf: ProcessDiagramProps['confidence'];
  w: number;
  h: number;
}) {
  const uid = useId().replace(/:/g, '');

  const BOX_W = 96;
  const BOX_H = 38;
  const PAD_X = 52;

  const xX = PAD_X + BOX_W / 2;
  const xM = w / 2;
  const xY = w - PAD_X - BOX_W / 2;
  const yTop = h * 0.15;
  const yBottom = h * 0.56;

  // W centered below
  const xW = w / 2;
  const yW = h * 0.88;

  // Midpoints
  const aPathMidX = (xX + BOX_W / 2 + (xM - BOX_W / 2)) / 2;
  const aPathMidY = (yBottom - BOX_H / 2 + yTop + BOX_H / 2) / 2;
  const bPathMidX = (xM + BOX_W / 2 + (xY - BOX_W / 2)) / 2;
  const bPathMidY = (yTop + BOX_H / 2 + yBottom - BOX_H / 2) / 2;
  const cPathMidX = (xX + BOX_W / 2 + (xY - BOX_W / 2)) / 2;
  const cPathMidY = yBottom;

  // Angles
  const aDx = (xM - BOX_W / 2) - (xX + BOX_W / 2);
  const aDy = (yTop + BOX_H / 2) - (yBottom - BOX_H / 2);
  const aAngle = Math.atan2(aDy, aDx) * (180 / Math.PI);

  const bDx = (xY - BOX_W / 2) - (xM + BOX_W / 2);
  const bDy = (yBottom - BOX_H / 2) - (yTop + BOX_H / 2);
  const bAngle = Math.atan2(bDy, bDx) * (180 / Math.PI);

  const aStars = getSigStars(pVals?.['a']);
  const bStars = getSigStars(pVals?.['b']);
  const cpStars = getSigStars(pVals?.['cPrime']);
  const intStars = getSigStars(pVals?.['interaction']);

  const aCi = conf?.['a'] ? `95% CI [${conf['a'][0].toFixed(3)}, ${conf['a'][1].toFixed(3)}]` : undefined;
  const bCi = conf?.['b'] ? `95% CI [${conf['b'][0].toFixed(3)}, ${conf['b'][1].toFixed(3)}]` : undefined;
  const cpCi = conf?.['cPrime'] ? `95% CI [${conf['cPrime'][0].toFixed(3)}, ${conf['cPrime'][1].toFixed(3)}]` : undefined;

  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }} aria-label="Model 59 conditional process diagram">
      <defs>
        <ArrowMarker id={`${uid}-arrow`} />
      </defs>

      {/* X → M (a path) */}
      <Arrow
        x1={xX + BOX_W / 2} y1={yBottom - BOX_H / 2 + 4}
        x2={xM - BOX_W / 2} y2={yTop + BOX_H / 2 - 4}
        label={coef?.a !== undefined ? `a = ${formatCoef(coef.a)}` : 'a'}
        sigStars={aStars}
        markerId={`${uid}-arrow`}
        ciLabel={aCi}
      />

      {/* M → Y (b path) */}
      <Arrow
        x1={xM + BOX_W / 2} y1={yTop + BOX_H / 2 - 4}
        x2={xY - BOX_W / 2} y2={yBottom - BOX_H / 2 + 4}
        label={coef?.b !== undefined ? `b = ${formatCoef(coef.b)}` : 'b'}
        sigStars={bStars}
        markerId={`${uid}-arrow`}
        ciLabel={bCi}
      />

      {/* X → Y (c' direct path) */}
      <Arrow
        x1={xX + BOX_W / 2} y1={yBottom}
        x2={xY - BOX_W / 2} y2={yBottom}
        label={coef?.cPrime !== undefined ? `c\u2032 = ${formatCoef(coef.cPrime)}` : "c\u2032"}
        sigStars={cpStars}
        markerId={`${uid}-arrow`}
        ciLabel={cpCi}
      />

      {/* W → a-path */}
      <line
        x1={xW - BOX_W / 2 + 4} y1={yW - BOX_H / 2}
        x2={aPathMidX} y2={aPathMidY}
        stroke="var(--color-text-secondary)"
        strokeWidth={1.5}
        markerEnd={`url(#${uid}-arrow)`}
      />

      {/* W → b-path */}
      <line
        x1={xW + BOX_W / 2 - 4} y1={yW - BOX_H / 2}
        x2={bPathMidX} y2={bPathMidY}
        stroke="var(--color-text-secondary)"
        strokeWidth={1.5}
        strokeDasharray="4 2"
        markerEnd={`url(#${uid}-arrow)`}
      />

      {/* W → c'-path (straight up from W center) */}
      <line
        x1={xW} y1={yW - BOX_H / 2}
        x2={cPathMidX} y2={cPathMidY + 10}
        stroke="var(--color-text-secondary)"
        strokeWidth={1.5}
        strokeDasharray="2 2"
        markerEnd={`url(#${uid}-arrow)`}
      />

      {coef?.interaction !== undefined && (
        <text
          x={xW + BOX_W / 2 + 4}
          y={(yW - BOX_H / 2 + cPathMidY + 10) / 2}
          fontSize={10}
          fontFamily="'IBM Plex Sans', sans-serif"
          fontStyle="italic"
          fill="var(--color-text-secondary)"
          textAnchor="start"
        >
          {formatCoef(coef.interaction)}{intStars}
        </text>
      )}

      {/* Tick on a-path */}
      <g transform={`translate(${aPathMidX}, ${aPathMidY}) rotate(${aAngle})`}>
        <line x1={0} y1={-7} x2={0} y2={7} stroke="var(--color-text-secondary)" strokeWidth={2} />
      </g>

      {/* Tick on b-path */}
      <g transform={`translate(${bPathMidX}, ${bPathMidY}) rotate(${bAngle})`}>
        <line x1={0} y1={-7} x2={0} y2={7} stroke="var(--color-text-secondary)" strokeWidth={2} />
      </g>

      {/* Tick on c'-path */}
      <line
        x1={cPathMidX} y1={cPathMidY - 6}
        x2={cPathMidX} y2={cPathMidY + 6}
        stroke="var(--color-text-secondary)"
        strokeWidth={2}
      />

      {/* Boxes */}
      <Box cx={xM} cy={yTop} w={BOX_W} h={BOX_H} label={truncLabel(vars.m)} sublabel="Mediator (M)" />
      <Box cx={xX} cy={yBottom} w={BOX_W} h={BOX_H} label={truncLabel(vars.x)} sublabel="Predictor (X)" />
      <Box cx={xY} cy={yBottom} w={BOX_W} h={BOX_H} label={truncLabel(vars.y)} sublabel="Outcome (Y)" />
      <Box cx={xW} cy={yW} w={BOX_W} h={BOX_H} label={truncLabel(vars.w)} sublabel="Moderator (W)" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function SignificanceLegend() {
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        fontSize: 9,
        fontFamily: "'IBM Plex Sans', sans-serif",
        color: 'var(--color-text-tertiary)',
        marginTop: 8,
        justifyContent: 'center',
      }}
    >
      <span>* p &lt; .05</span>
      <span>** p &lt; .01</span>
      <span>*** p &lt; .001</span>
      <span style={{ color: 'var(--color-text-muted)' }}>Hover paths for 95% CI</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model title
// ---------------------------------------------------------------------------

const MODEL_TITLES: Record<ProcessDiagramProps['modelType'], string> = {
  mediation: 'Simple Mediation (PROCESS Model 4)',
  moderation: 'Simple Moderation (PROCESS Model 1)',
  'moderated-mediation': 'Moderated Mediation (PROCESS Model 7)',
  'serial-mediation': 'Serial Mediation (PROCESS Model 6)',
  'model-8': "Conditional Process Model 8 (W \u2192 a, c\u2032)",
  'model-58': 'Conditional Process Model 58 (W \u2192 a, b)',
  'model-59': "Conditional Process Model 59 (W \u2192 a, b, c\u2032)",
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * ProcessDiagram renders PROCESS model path diagrams as interactive SVGs.
 *
 * Supported models:
 * - mediation           — Model 4: X → M → Y + direct
 * - moderation          — Model 1: X → Y with W moderating
 * - moderated-mediation — Model 7/14: X → M → Y with W on a-path
 * - serial-mediation    — Model 6: X → M1 → M2 → Y
 *
 * Path labels show coefficients in italic with significance stars.
 * Hover over any path arrow to reveal the bootstrap 95% CI tooltip.
 */
export function ProcessDiagram({
  modelType,
  variables,
  coefficients = {},
  pValues = {},
  confidence = {},
  width = 540,
  height = 220,
}: ProcessDiagramProps) {
  const title = MODEL_TITLES[modelType];

  const sharedProps = {
    vars: variables,
    coef: coefficients,
    pVals: pValues,
    conf: confidence,
    w: width,
    h: height,
  };

  let diagram: ReactNode;
  switch (modelType) {
    case 'mediation':
      diagram = <MediationDiagram {...sharedProps} />;
      break;
    case 'moderation':
      diagram = <ModerationDiagram {...sharedProps} />;
      break;
    case 'moderated-mediation':
      diagram = <ModeratedMediationDiagram {...sharedProps} />;
      break;
    case 'serial-mediation':
      diagram = <SerialMediationDiagram {...sharedProps} />;
      break;
    case 'model-8':
      diagram = <Model8Diagram {...sharedProps} />;
      break;
    case 'model-58':
      diagram = <Model58Diagram {...sharedProps} />;
      break;
    case 'model-59':
      diagram = <Model59Diagram {...sharedProps} />;
      break;
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        maxWidth: '100%',
      }}
      className="my-3"
    >
      {/* APA-style italic title */}
      <p
        style={{
          fontSize: 11,
          fontStyle: 'italic',
          fontWeight: 500,
          color: 'var(--color-text-secondary)',
          marginBottom: 6,
          fontFamily: "'IBM Plex Sans', sans-serif",
        }}
      >
        {title}
      </p>

      {/* SVG container with subtle border */}
      <div
        style={{
          border: '1px solid var(--color-border-light)',
          borderRadius: 6,
          background: 'var(--color-bg-secondary)',
          padding: '12px 16px 8px',
          width: width,
          maxWidth: '100%',
          boxSizing: 'border-box',
          overflowX: 'auto',
        }}
      >
        {diagram}
        <SignificanceLegend />
      </div>
    </div>
  );
}
