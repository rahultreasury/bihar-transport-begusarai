/**
 * scripts/extract-vehicle-hire-workspace.mjs
 * ---------------------------------------------------------------------------
 * A ONE-OFF, VERIFIABLE CODE MOVE — not a rewrite.
 *
 * WHAT IT DOES
 *   Lifts the complete Universal Vehicle Hire workspace out of the PAGE
 *   component `pages/AdminVehicleHire.jsx` and into a SHELL-FREE component,
 *   `components/admin-premium/trips/process/VehicleHireWorkspace.jsx`.
 *
 * WHY
 *   The hire workspace is the whole operational screen for the Vehicle process,
 *   but it was welded to a page that draws its own `AdminShell`. The Trip
 *   process router (`AdminTripProcess`) already draws that shell, so the same
 *   workspace could never be rendered at `/admin/trips/:tripId/vehicle` without
 *   nesting a second sidebar inside the page. Moving the body out is what lets
 *   ONE implementation serve both hosts.
 *
 * IT MOVES CODE, IT DOES NOT REWRITE IT
 *   Every state hook, callback, validation rule, JSX section and money figure is
 *   copied byte-for-byte. The ONLY edits made here are the ones that make the
 *   body reusable:
 *     1. the component signature takes `tripId` / `embedded` / `editMode` as
 *        props instead of reading the route itself;
 *     2. each `<AdminShell …>` wrapper is dropped and its children dedented,
 *        because the host now owns the console frame;
 *     3. `editPath` replaces a hardcoded edit URL, so the same "edit this hire"
 *        action is correct in both hosts.
 *
 * Run:  node scripts/extract-vehicle-hire-workspace.mjs
 * LOCAL ONLY.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');
const PAGE = path.join(SRC, 'pages', 'AdminVehicleHire.jsx');
const OUT = path.join(SRC, 'components', 'admin-premium', 'trips', 'process', 'VehicleHireWorkspace.jsx');

const original = readFileSync(PAGE, 'utf8');
const lines = original.split('\n');

/** 1-indexed slice, matching the line numbers read during inspection. */
const slice = (from, to) => lines.slice(from - 1, to);

const helpers = slice(76, 337);      // formatting · doc status · RadioGroup · SearchableSelect
const componentBody = slice(358, 1574); // every state hook, handler and JSX section

const HEADER = `/**
 * VehicleHireWorkspace.jsx
 * ---------------------------------------------------------------------------
 * THE UNIVERSAL VEHICLE HIRE WORKSPACE — the screen itself, with no page frame.
 *
 *   ORDER CONFIRMED → WAITING FOR VEHICLE → [ Hire Vehicle ] → VEHICLE HIRED
 *
 * THIS IS THE ONE IMPLEMENTATION
 *   There is no Contract Hire page and no Commission Hire page. "Billing To"
 *   decides which commercial model a hire is, and the Business Model is DERIVED
 *   from it and shown read-only. Two pages would be two implementations of the
 *   same arithmetic drifting apart.
 *
 * WHY IT HAS NO \`AdminShell\`
 *   The workspace is rendered by TWO hosts, and each already supplies the console
 *   frame:
 *     • \`pages/AdminVehicleHire.jsx\`  → the standalone route at
 *       /admin/trips/:tripId/vehicle-hire
 *     • \`VehicleWorkspace.jsx\`       → the \`vehicle\` stage of the Trip process,
 *       i.e. /admin/trips/:tripId/vehicle, inside \`TripProcessShell\`
 *   Drawing a shell here would nest a second sidebar inside the process page.
 *   So the frame belongs to the host and the workspace renders only its own work.
 *
 * \`embedded\` tells this component which host it is in, for exactly one thing:
 * whether to repeat a page header the host has already drawn.
 *
 * EVERYTHING ELSE IS UNCHANGED FROM THE ORIGINAL PAGE
 *   Same state hooks, same validation, same server-calculated money, same three
 *   separate figures (gross / commission / net), same challan, same endpoints.
 *   Only the chrome moved.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Truck,
  FileText,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Download,
  Share2,
  Percent,
  Building2,
} from 'lucide-react';

import {
  PageHeader,
  Button,
  StatusBadge,
  FormField,
  SectionCard,
  ErrorState,
  BlankState,
  DetailRow,
  IconTile,
} from '../../ui';
import { vehicleHireAPI } from '../../../../services/vehicleHireAPI';
`;

const SIGNATURE = `
/* ══════════════════════════════════════════════════════════════════════════
   THE WORKSPACE
   ─────────────────────────────────────────────────────────────────────────
   ══════════════════════════════════════════════════════════════════════════ */

export default function VehicleHireWorkspace({
  tripId,
  embedded = false,
  editMode = false,
}) {
  const navigate = useNavigate();

  /**
   * \`editPath\` — where "edit this hire" goes from HERE.
   *
   * The same pre-filled form has to be reachable from both hosts. \`?edit=1\` is
   * what selects it, and the workspace UPDATEs the one existing hire rather than
   * creating a second one.
   */
  const editPath = embedded
    ? \`/admin/trips/\${tripId}/vehicle?edit=1\`
    : \`/admin/trips/\${tripId}/vehicle-hire?edit=1\`;
`;

/** Remove an \`<AdminShell …>\` … \`</AdminShell>\` pair, dedenting its children. */
function stripAdminShell(block) {
  const out = [];
  let depth = 0;
  for (const line of block) {
    // The opening tag carries `onNav={() => {}}`, so it is matched as "starts with
    // <AdminShell and ends with >" rather than by a strict attribute pattern —
    // `[^>]*` would stop at the arrow in `=>` and miss the tag entirely.
    const open = line.match(/^(\s*)<AdminShell\b.*>\s*$/);
    const close = line.match(/^(\s*)<\/AdminShell>\s*$/);
    if (open) {
      depth += 1;
      continue;
    }
    if (close) {
      depth -= 1;
      continue;
    }
    if (depth > 0 && line.startsWith('  ')) out.push(line.slice(2));
    else out.push(line);
  }
  if (depth !== 0) throw new Error(`Unbalanced <AdminShell> (depth ${depth})`);
  return out;
}

const assembled = [HEADER, ...helpers, SIGNATURE, ...stripAdminShell(componentBody)].join('\n');

writeFileSync(OUT, assembled, 'utf8');
console.log(`wrote ${path.relative(process.cwd(), OUT)} (${assembled.split('\n').length} lines)`);
