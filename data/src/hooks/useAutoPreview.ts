import { useEffect, useMemo, useRef } from "react";
import { useEditorStore } from "../store/editorStore";
import { useQueryStore } from "../store/queryStore";
import { usePreviewStore } from "../store/previewStore";
import { useSettingsStore } from "../store/settingsStore";
import { useFileStore } from "../store/fileStore";
import { useConnectionStore } from "../store/connectionStore";
import { buildUpTo } from "../engine/cteBuilder";
import { createQueryResolver } from "../engine/references";
import { executeSQL } from "../engine/executor";
import { prepareSourceSteps } from "../lib/datasetFiles";
import { computeProfiles } from "../lib/profiling";

/**
 * Auto-preview hook. Runs the enabled pipeline up to the active step whenever
 * the relevant inputs change, and only resets the preview state when the
 * active query/step context actually becomes invalid. Care is taken not to
 * call setData/setError on every render, which would trigger an infinite
 * update loop.
 */
export function useAutoPreview() {
  const activeQueryId = useEditorStore((s) => s.activeQueryId);
  const activeStepId = useEditorStore((s) => s.activeStepId);
  const queries = useQueryStore((s) => s.queries);
  const previewLimit = useSettingsStore((s) => s.previewLimit);
  const autoRun = useSettingsStore((s) => s.autoRun);
  const fileStatus = useFileStore((s) => s.status);
  const runNonce = usePreviewStore((s) => s.runNonce);

  const {
    setLoading,
    setError,
    setData,
    setProfiles,
    setActiveStepIndex,
    setDuration,
    pushRun,
    requestRun,
  } = usePreviewStore();

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  const lastClearedRef = useRef<string | null>(null);

  const activeQuery = useMemo(
    () => queries.find((q) => q.id === activeQueryId),
    [queries, activeQueryId],
  );
  const steps = activeQuery?.steps ?? [];

  // Reset preview state only when the selection context becomes invalid.
  // Using a key derived from the inputs avoids firing setData on every render.
  useEffect(() => {
    const shouldClear =
      !activeQueryId ||
      steps.length === 0 ||
      !activeStepId ||
      steps.findIndex((s) => s.id === activeStepId) < 0 ||
      steps.filter((s) => s.enabled).findIndex((s) => s.id === activeStepId) < 0;

    const clearKey = `${activeQueryId ?? ""}:${activeStepId ?? ""}:${steps.length}:${shouldClear}`;
    if (!shouldClear || lastClearedRef.current === clearKey) return;

    lastClearedRef.current = clearKey;
    setData(null);
    setError(null);
    setActiveStepIndex(-1);
  }, [activeQueryId, activeStepId, steps, setData, setError, setActiveStepIndex]);

  // Run preview when the pipeline context is valid and has changed.
  useEffect(() => {
    if (!activeQueryId || steps.length === 0 || !activeStepId) return;

    const activeIndex = steps.findIndex((s) => s.id === activeStepId);
    if (activeIndex < 0) return;

    const enabledSteps = steps.filter((s) => s.enabled);
    const enabledIndex = enabledSteps.findIndex((s) => s.id === activeStepId);
    if (enabledIndex < 0) return;

    // autoRun gate: when off, only run on an explicit manual request (runNonce).
    if (!autoRun && runNonce === 0) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    const run = async () => {
      const myReq = ++reqIdRef.current;
      setLoading(true);
      setError(null);
      const startedAt = performance.now();

      try {
        const resolveQuery = createQueryResolver(queries);
        const compiled = buildUpTo(steps, enabledIndex, resolveQuery);

        // Ensure source files/tables are registered before running. This re-reads
        // linked folder files when DuckDB buffers were lost (hard refresh).
        const enabledSteps = steps.filter((s) => s.enabled);
        const stepsToPreflight = enabledSteps.slice(0, enabledIndex + 1);
        const connections = useConnectionStore.getState().connections;
        await prepareSourceSteps(stepsToPreflight, connections);

        const result = await executeSQL(compiled.fullSQL, previewLimit);

        if (myReq !== reqIdRef.current) return;

        setDuration(Math.round(performance.now() - startedAt));

        if (result.error) {
          setError(result.error);
          setData(null);
          setProfiles([]);
        } else if (result.data) {
          setData(result.data);
          setProfiles(computeProfiles(result.data));
          setActiveStepIndex(enabledIndex);
          pushRun({
            queryId: activeQueryId,
            stepId: activeStepId,
            rowCount: result.data.rowCount,
            durationMs: Math.round(performance.now() - startedAt),
          });
        }
      } catch (e) {
        if (myReq !== reqIdRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setData(null);
      }
    };

    timerRef.current = setTimeout(run, autoRun ? 400 : 0);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeQueryId,
    activeStepId,
    // steps is derived from activeQuery which is derived from queries + activeQueryId;
    // including it would re-trigger when the array reference changes each render.
    activeQuery?.id,
    activeQuery?.updatedAt,
    queries,
    previewLimit,
    autoRun,
    runNonce,
    fileStatus,
    setLoading,
    setError,
    setData,
    setProfiles,
    setActiveStepIndex,
    setDuration,
    pushRun,
  ]);

  return { requestRun, autoRun };
}
