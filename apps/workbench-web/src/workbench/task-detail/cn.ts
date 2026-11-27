/**
 * Minimal classnames join for the task-detail module. Local on purpose: this
 * module must render inside the parent workbench shell without depending on
 * apps/web aliases.
 */
export function cn(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
