/**
 * Design tokens measured from the 03.01 Pencil export
 * (.scratch/agent-team-workbench/reference/03-01-workflow-editor.json).
 * Values are exact; do not approximate them.
 */

export const workflowDesignTokens = {
  pageBackground: "rgb(10, 15, 26)",
  navBackground: "rgb(16, 25, 39)",
  panelBackground: "rgb(16, 26, 41)",
  panelBorder: "rgb(42, 56, 75)",
  panelRadius: "14px",
  canvasBackground: "rgb(13, 23, 37)",
  inputBackground: "rgb(10, 15, 26)",
  inputBorder: "rgb(42, 56, 75)",
  inputRadius: "12.5px",
  chipBackground: "rgb(17, 29, 45)",
  chipSelectedBackground: "rgba(26, 221, 255, 0.1)",
  chipRadius: "8px",
  accent: "rgb(26, 221, 255)",
  accentDim: "rgba(26, 221, 255, 0.4)",
  text: "rgb(243, 244, 247)",
  textMuted: "rgb(154, 168, 188)",
  nodeBackground: "rgb(22, 35, 53)",
  nodeBorder: "rgb(57, 80, 104)",
  nodeSelectedBackground: "rgb(21, 46, 61)",
  nodeSelectedBorder: "rgb(53, 213, 235)",
  portColor: "rgb(82, 199, 217)",
  danger: "rgb(239, 67, 67)",
  zoomBackground: "rgb(18, 29, 46)",
  zoomButtonBackground: "rgb(32, 50, 70)",
  zoomButtonBorder: "rgb(55, 76, 97)",
  promptBorder: "rgb(69, 96, 118)",
  fontStack: "Inter, system-ui, sans-serif",
} as const;

/** Scoped stylesheet for the workflow editor. All rules live under .wb-workflow-editor. */
export function workflowEditorCss(): string {
  const t = workflowDesignTokens;
  return `
.wb-workflow-editor, .wb-workflow-editor * { box-sizing: border-box; margin: 0; padding: 0; font-family: ${t.fontStack}; }
.wb-workflow-editor { min-height: 100vh; background: ${t.pageBackground}; color: ${t.text}; font-size: 15px; }
.wb-workflow-editor button { cursor: pointer; border: none; background: none; color: inherit; font: inherit; }
.wb-workflow-editor input, .wb-workflow-editor textarea, .wb-workflow-editor select {
  background: ${t.inputBackground}; border: 1px solid ${t.inputBorder}; border-radius: ${t.inputRadius};
  color: ${t.text}; padding: 12px 16px; font-size: 15px; width: 100%; outline: none;
}
.wb-workflow-editor input:focus, .wb-workflow-editor textarea:focus, .wb-workflow-editor select:focus { border-color: ${t.accent}; }
.wb-nav { display: flex; align-items: center; justify-content: space-between; height: 64px; padding: 0 32px; background: ${t.navBackground}; border-bottom: 1px solid ${t.panelBorder}; }
.wb-crumbs { display: flex; align-items: center; gap: 10px; font-size: 15px; }
.wb-crumbs .wb-avatar { width: 28px; height: 28px; border-radius: 50%; border: 1px solid ${t.accentDim}; display: grid; place-items: center; color: ${t.accent}; font-weight: 600; }
.wb-crumbs .wb-crumb-team { color: ${t.text}; font-weight: 600; font-size: 15px; }
.wb-crumbs .wb-crumb-sep, .wb-crumbs .wb-crumb-page { color: ${t.textMuted}; }
.wb-agent-badge { background: ${t.pageBackground}; border: 1px solid ${t.panelBorder}; border-radius: ${t.inputRadius}; padding: 10px 18px; display: flex; align-items: center; gap: 10px; }
.wb-agent-badge strong { color: ${t.text}; font-weight: 500; font-size: 15px; }
.wb-agent-badge span { color: ${t.textMuted}; font-size: 13px; }
.wb-page { max-width: 1440px; margin: 0 auto; padding: 40px 80px 24px; display: flex; flex-direction: column; gap: 24px; }
.wb-title-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
.wb-title-row h1 { font-size: 36px; font-weight: 600; color: ${t.text}; }
.wb-subtitle { margin-top: 8px; color: ${t.textMuted}; font-size: 17px; display: flex; align-items: center; gap: 12px; }
.wb-io-row { display: flex; gap: 16px; width: 640px; flex-shrink: 0; }
.wb-io-row .wb-io { flex: 1; }
.wb-io-label { color: ${t.textMuted}; font-size: 13px; font-weight: 500; margin-bottom: 8px; }
.wb-io-box { background: ${t.inputBackground}; border: 1px solid ${t.inputBorder}; border-radius: ${t.inputRadius}; padding: 12px 16px; min-height: 42px; color: ${t.text}; cursor: pointer; }
.wb-panel { background: ${t.panelBackground}; border: 1px solid ${t.panelBorder}; border-radius: ${t.panelRadius}; padding: 26px 26px 28px; }
.wb-panel-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
.wb-panel-head h2 { font-size: 22px; font-weight: 600; color: ${t.text}; }
.wb-panel-head .wb-hint { margin-top: 6px; color: ${t.textMuted}; font-size: 13px; }
.wb-btn { display: inline-flex; align-items: center; gap: 8px; border-radius: ${t.inputRadius}; padding: 11px 18px; font-size: 15px; font-weight: 500; }
.wb-btn-ghost { color: ${t.textMuted}; }
.wb-btn-outline { background: ${t.pageBackground}; border: 1px solid ${t.panelBorder}; color: ${t.text}; }
.wb-btn-outline:disabled { opacity: 0.5; cursor: not-allowed; }
.wb-btn-accent { background: ${t.accent}; color: rgb(4, 16, 26); font-weight: 600; }
.wb-btn-accent:disabled { opacity: 0.5; cursor: not-allowed; }
.wb-btn-danger { color: ${t.danger}; }
.wb-btn-primary { background: ${t.accent}; color: ${t.pageBackground}; }
.wb-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.wb-describe-panel { background: ${t.panelBackground}; border: 1px solid ${t.panelBorder}; border-radius: ${t.panelRadius}; padding: 26px 26px 28px; max-width: 720px; display: flex; flex-direction: column; gap: 14px; }
.wb-describe-panel h2 { font-size: 26px; font-weight: 600; color: ${t.text}; }
.wb-materials { display: flex; flex-direction: column; gap: 8px; }
.wb-field-error { color: ${t.danger}; font-size: 13px; }
.wb-field-label { color: ${t.textMuted}; font-size: 13px; font-weight: 500; margin-bottom: 8px; display: block; }
.wb-form-grid { display: grid; grid-template-columns: minmax(300px, 420px) 1fr; gap: 16px 24px; margin-bottom: 20px; }
.wb-members { border-radius: ${t.chipRadius}; padding: 10px; display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px 12px; }
.wb-member-chip { display: flex; align-items: center; gap: 8px; background: ${t.chipBackground}; border-radius: ${t.chipRadius}; height: 38px; padding: 0 12px; text-align: left; width: 100%; }
.wb-member-chip.is-selected { background: ${t.chipSelectedBackground}; }
.wb-member-chip.is-auto { cursor: default; }
.wb-member-dot { width: 16px; height: 16px; border-radius: 50%; border: 1px solid ${t.accentDim}; flex-shrink: 0; display: grid; place-items: center; }
.wb-member-chip.is-selected .wb-member-dot { background: ${t.accent}; border-color: ${t.accent}; }
.wb-member-name { color: ${t.text}; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wb-member-tag { margin-left: auto; color: ${t.textMuted}; font-size: 12px; white-space: nowrap; }
.wb-members-caption { margin-top: 10px; color: ${t.textMuted}; font-size: 13px; }
.wb-canvas-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.wb-canvas-toolbar h2 { font-size: 22px; font-weight: 600; margin-right: 8px; }
.wb-canvas-hint { color: ${t.textMuted}; font-size: 13px; margin-left: 8px; }
.wb-canvas { position: relative; height: 420px; background: ${t.canvasBackground}; border-radius: 10px; overflow: hidden;
  background-image: linear-gradient(${t.nodeBorder} 1px, transparent 1px), linear-gradient(90deg, ${t.nodeBorder} 1px, transparent 1px);
  background-size: 32px 32px; background-position: center; opacity: 1; }
.wb-canvas-grid-dim { position: absolute; inset: 0; background: rgba(13, 23, 37, 0.35); pointer-events: none; }
.wb-canvas-world { position: absolute; left: 50%; top: 50%; transform-origin: center center; }
.wb-node { position: absolute; width: 200px; background: ${t.nodeBackground}; border: 1px solid ${t.nodeBorder}; border-radius: 12px; padding: 14px 16px; cursor: grab; user-select: none; }
.wb-node.is-selected { background: ${t.nodeSelectedBackground}; border-color: ${t.nodeSelectedBorder}; }
.wb-node strong { display: block; color: ${t.text}; font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wb-node span { display: block; margin-top: 6px; color: ${t.textMuted}; font-size: 12px; }
.wb-port { position: absolute; width: 10px; height: 10px; border-radius: 50%; background: ${t.portColor}; border: 2px solid ${t.pageBackground}; }
.wb-port.is-target { left: -5px; top: 50%; margin-top: -5px; cursor: crosshair; }
.wb-port.is-source { right: -5px; top: 50%; margin-top: -5px; cursor: crosshair; }
.wb-edges { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
.wb-edge-path { fill: none; stroke: ${t.portColor}; stroke-opacity: 0.55; stroke-width: 1.6; pointer-events: stroke; cursor: pointer; }
.wb-edge-path.is-selected { stroke: ${t.accent}; stroke-opacity: 1; stroke-width: 2; }
.wb-zoom { position: absolute; right: 16px; bottom: 16px; display: flex; flex-direction: column; background: ${t.zoomBackground}; border: 1px solid ${t.panelBorder}; border-radius: 10px; overflow: hidden; }
.wb-zoom button { width: 32px; height: 32px; display: grid; place-items: center; color: ${t.textMuted}; background: ${t.zoomButtonBackground}; border-bottom: 1px solid ${t.zoomButtonBorder}; }
.wb-zoom button:last-child { border-bottom: none; }
.wb-zoom button:hover { color: ${t.text}; }
.wb-step-form-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px 24px; margin-bottom: 20px; }
.wb-prompt-title { font-size: 17px; font-weight: 600; margin-bottom: 12px; }
.wb-prompt-editor { min-height: 180px; resize: vertical; border-color: ${t.promptBorder} !important; border-radius: 10px !important; }
.wb-run-params { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px 24px; margin-top: 20px; }
.wb-footer { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding-top: 8px; }
.wb-footer-status { color: ${t.textMuted}; font-size: 13px; }
.wb-footer-status.has-problem { color: ${t.danger}; }
.wb-footer-actions { display: flex; gap: 10px; margin-left: auto; }
.wb-history-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.wb-history-row { display: flex; align-items: center; gap: 12px; background: ${t.chipBackground}; border-radius: ${t.chipRadius}; padding: 10px 14px; }
.wb-history-row .wb-history-name { color: ${t.text}; font-size: 14px; font-weight: 500; }
.wb-history-row .wb-history-meta { color: ${t.textMuted}; font-size: 12px; margin-left: auto; }
.wb-fields-editor { border-top: 1px solid ${t.panelBorder}; margin-top: 16px; padding-top: 16px; display: flex; flex-direction: column; gap: 12px; }
.wb-field-row { display: grid; grid-template-columns: 1fr 1fr 120px 90px 2fr auto; gap: 8px; align-items: center; }
.wb-field-row input, .wb-field-row select { padding: 8px 12px; font-size: 13px; }
.wb-problems { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.wb-problem { color: ${t.danger}; font-size: 13px; }
.wb-empty { display: grid; place-items: center; height: 100%; color: ${t.textMuted}; font-size: 14px; text-align: center; padding: 24px; }
`;
}
