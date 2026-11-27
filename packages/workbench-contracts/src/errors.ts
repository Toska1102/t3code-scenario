import * as Schema from "effect/Schema";

/** Every failed workbench request answers with this shape; `field` and `id` locate the problem. */
export const WorkbenchError = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String,
    field: Schema.optional(Schema.String),
    id: Schema.optional(Schema.String),
  }),
});
export type WorkbenchError = typeof WorkbenchError.Type;

export const WORKBENCH_ERROR_CODES = [
  "invalid_request",
  "validation_failed",
  "not_found",
  "internal_error",
] as const;
export type WorkbenchErrorCode = (typeof WORKBENCH_ERROR_CODES)[number];
