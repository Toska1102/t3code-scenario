import { useEffect, useState } from "react";

export type Resource<Value> =
  | { status: "loading" }
  | { status: "ready"; value: Value }
  | { status: "failed"; message: string };

export function useResource<Value>(load: (signal: AbortSignal) => Promise<Value>) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    load: typeof load;
    attempt: number;
    resource: Resource<Value>;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted)
          setResult({ load, attempt, resource: { status: "ready", value } });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            load,
            attempt,
            resource: {
              status: "failed",
              message: error instanceof Error ? error.message : "无法加载，请重试。",
            },
          });
      },
    );
    return () => controller.abort();
  }, [load, attempt]);
  const resource: Resource<Value> =
    result?.load === load && result.attempt === attempt ? result.resource : { status: "loading" };
  return { resource, retry: () => setAttempt((value) => value + 1) };
}
