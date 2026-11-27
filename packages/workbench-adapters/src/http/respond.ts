import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { WorkbenchErrors } from "@t3tools/workbench-contracts";

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

export const json = <A>(
  schema: Schema.Codec<A>,
  value: A,
  status = 200,
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.jsonUnsafe(Schema.encodeSync(schema)(value), {
    status,
    headers: JSON_HEADERS,
  });

type FailureFields = Omit<WorkbenchErrors.WorkbenchError["error"], "field" | "id">;
export type Failure = FailureFields & {
  readonly field?: string | undefined;
  readonly id?: string | undefined;
};

export const failure = (status: number, error: Failure): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.text(JSON.stringify({ error }), { status, headers: JSON_HEADERS });

export class InvalidRequestBodyError extends Schema.TaggedError<InvalidRequestBodyError>()(
  "InvalidRequestBodyError",
  { cause: Schema.Defect() },
) {}

/** Reads the JSON body as `schema`, or fails so the route can answer 400. */
export const decodeBody = <A>(
  schema: Schema.Codec<A>,
): Effect.Effect<A, InvalidRequestBodyError, HttpServerRequest.HttpServerRequest> =>
  Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => request.json).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.catch((cause) => new InvalidRequestBodyError({ cause })),
  );

export const invalidRequest = (_: InvalidRequestBodyError) =>
  Effect.succeed(
    failure(400, { code: "invalid_request", message: "The request body could not be read." }),
  );

export const validation = (error: { readonly field: string; readonly problem: string }) =>
  Effect.succeed(
    failure(400, {
      code: "validation_failed",
      field: error.field,
      message: `The ${error.field} is ${error.problem}.`,
    }),
  );

export const internal = (error: object) =>
  Effect.logError("Workbench storage failed", error).pipe(
    Effect.as(
      failure(500, {
        code: "internal_error",
        message: "The workbench could not read or write its storage.",
      }),
    ),
  );
