import { useEffect, useMemo, useState } from "react";

type DayName =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

type Equipment =
  | "db"
  | "barbell"
  | "ez_bar_fixed"
  | "ez_bar_plate"
  | "ez_bar"
  | "machine"
  | "cable"
  | "bodyweight";

type RepScheme = {
  workRangeMin: number;
  workRangeMax: number;
};

type ExerciseSettings = {
  id: string;
  name: string;
  equipment: Equipment;
  repScheme: RepScheme;
};

type WorkoutLibraryItem = {
  id: string;
  name: string;
  exerciseIds: string[];
};

type SplitDay = {
  name: DayName;
  workoutId: string | null;
};

type Week = {
  id: string;
  name: string;
  days: SplitDay[];
};

type Split = {
  weeks: Week[];
};

type PersistedState = {
  exercises: ExerciseSettings[];
  workoutLibrary?: WorkoutLibraryItem[];
  split?: Split;
};

type ExportSplit = {
  weeks: Week[];
};

const ALL_DAYS: DayName[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function ExportModal({
  open,
  value,
  onClose,
}: {
  open: boolean;
  value: string;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-[95vw] max-w-[520px] bg-white rounded-t-3xl sm:rounded-3xl p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">Export Split</div>
          <button
            className="text-sm font-semibold px-3 py-2 rounded-xl bg-gray-100"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        <div className="mt-3">
          <textarea
            className="w-full h-64 px-3 py-2 rounded-xl border border-gray-200 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-black"
            value={value}
            readOnly
          />
        </div>
      </div>
    </div>
  );
}

function ImportModal({
  open,
  value,
  error,
  canImport,
  onChange,
  onValidate,
  onImport,
  onClose,
}: {
  open: boolean;
  value: string;
  error: string | null;
  canImport: boolean;
  onChange: (v: string) => void;
  onValidate: () => void;
  onImport: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-[95vw] max-w-[520px] bg-white rounded-t-3xl sm:rounded-3xl p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">Import Split</div>
          <button
            className="text-sm font-semibold px-3 py-2 rounded-xl bg-gray-100"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
        </div>
        <div className="mt-3 space-y-3">
          <textarea
            className="w-full h-56 px-3 py-2 rounded-xl border border-gray-200 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-black"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder='Paste split JSON here...'
          />
          {error ? <div className="text-xs text-red-600">{error}</div> : null}
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 px-4 py-3 rounded-2xl bg-gray-100 text-sm font-semibold"
              onClick={onValidate}
            >
              Validate
            </button>
            <button
              type="button"
              className="flex-1 px-4 py-3 rounded-2xl bg-black text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onImport}
              disabled={!canImport}
            >
              Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SplitEditorPage({
  state,
  exercisesById,
  onSetDay,
  onAddWeek,
  onDeleteWeek,
  onRenameWeek,
  onReorderWorkoutExercise,
  onAddExerciseToWorkout,
  onRemoveExerciseFromWorkout,
  onRequestImportSplit,
}: {
  state: PersistedState;
  exercisesById: Map<string, ExerciseSettings>;
  onSetDay: (weekId: string, day: DayName, workoutId: string | null) => void;
  onAddWeek: () => string;
  onDeleteWeek: (weekId: string) => void;
  onRenameWeek: (weekId: string, name: string) => void;
  onReorderWorkoutExercise: (workoutId: string, fromIndex: number, toIndex: number) => void;
  onAddExerciseToWorkout: (workoutId: string, exerciseId: string) => void;
  onRemoveExerciseFromWorkout: (workoutId: string, exerciseId: string) => void;
  onRequestImportSplit: (weeks: Week[]) => void;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importReady, setImportReady] = useState(false);
  const [importWeeks, setImportWeeks] = useState<Week[] | null>(null);
  const [openWeekIds, setOpenWeekIds] = useState<string[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [addExerciseId, setAddExerciseId] = useState("");
  const [scrollToWeekId, setScrollToWeekId] = useState<string | null>(null);

  const weeks = state.split?.weeks || [];
  const library = state.workoutLibrary || [];
  const workoutById = useMemo(
    () => new Map(library.map((w) => [w.id, w] as const)),
    [library]
  );

  useEffect(() => {
    if (weeks.length === 0) {
      if (openWeekIds.length) setOpenWeekIds([]);
      return;
    }
    if (openWeekIds.length === 0) {
      setOpenWeekIds(weeks.map((w) => w.id));
      return;
    }
    const valid = openWeekIds.filter((id) => weeks.some((w) => w.id === id));
    if (valid.length !== openWeekIds.length) setOpenWeekIds(valid);
  }, [weeks, openWeekIds]);

  useEffect(() => {
    setAddExerciseId("");
  }, [openKey]);

  useEffect(() => {
    if (!openKey) return;
    const weekId = openKey.split(":")[0];
    if (!weeks.some((w) => w.id === weekId)) setOpenKey(null);
  }, [openKey, weeks]);

  useEffect(() => {
    if (!scrollToWeekId) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(`week-${scrollToWeekId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    setScrollToWeekId(null);
  }, [scrollToWeekId]);

  const options = useMemo(() => {
    const base = [{ value: "", label: "Rest" }];
    return base.concat(library.map((w) => ({ value: w.id, label: w.name })));
  }, [library]);

  const exportText = useMemo(() => {
    const weekExports: Week[] = weeks.map((week) => {
      const dayMap = new Map(week.days.map((d) => [d.name, d.workoutId] as const));
      const days = ALL_DAYS.map((day) => ({
        name: day,
        workoutId: dayMap.get(day) ?? null,
      }));
      return { id: week.id, name: week.name, days };
    });
    const data: ExportSplit = { weeks: weekExports };
    return JSON.stringify(data, null, 2);
  }, [weeks]);

  const resetImportState = () => {
    setImportText("");
    setImportError(null);
    setImportReady(false);
    setImportWeeks(null);
  };

  const handleImportChange = (value: string) => {
    setImportText(value);
    setImportError(null);
    setImportReady(false);
    setImportWeeks(null);
  };

  const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

  const validateImport = () => {
    setImportError(null);
    setImportReady(false);
    setImportWeeks(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      setImportError("Invalid JSON. Please check formatting.");
      return;
    }

    if (!isPlainObject(parsed)) {
      setImportError("Top-level JSON must be an object.");
      return;
    }

    const keys = Object.keys(parsed);
    if (keys.length !== 1 || keys[0] !== "weeks") {
      setImportError("JSON must contain only a top-level 'weeks' array.");
      return;
    }

    const weeksValue = (parsed as { weeks?: unknown }).weeks;
    if (!Array.isArray(weeksValue) || weeksValue.length === 0) {
      setImportError("'weeks' must be a non-empty array.");
      return;
    }

    const workoutIds = new Set(library.map((w) => w.id));
    const seenWeekIds = new Set<string>();
    const normalizedWeeks: Week[] = [];

    for (let i = 0; i < weeksValue.length; i += 1) {
      const week = weeksValue[i];
      if (!isPlainObject(week)) {
        setImportError(`Week ${i + 1} must be an object.`);
        return;
      }
      const weekKeys = Object.keys(week);
      if (weekKeys.length !== 3 || !weekKeys.includes("id") || !weekKeys.includes("name") || !weekKeys.includes("days")) {
        setImportError(`Week ${i + 1} must include only id, name, and days.`);
        return;
      }
      const id = (week as { id?: unknown }).id;
      const name = (week as { name?: unknown }).name;
      const days = (week as { days?: unknown }).days;
      if (typeof id !== "string" || id.trim() === "") {
        setImportError(`Week ${i + 1} has an invalid id.`);
        return;
      }
      if (seenWeekIds.has(id)) {
        setImportError(`Duplicate week id '${id}' found.`);
        return;
      }
      seenWeekIds.add(id);
      if (typeof name !== "string" || name.trim() === "") {
        setImportError(`Week ${i + 1} has an invalid name.`);
        return;
      }
      if (!Array.isArray(days) || days.length !== 7) {
        setImportError(`Week ${i + 1} must have exactly 7 days.`);
        return;
      }

      const seenDayNames = new Set<DayName>();
      const normalizedDays: SplitDay[] = [];
      for (const day of days) {
        if (!isPlainObject(day)) {
          setImportError(`Week ${i + 1} contains an invalid day.`);
          return;
        }
        const dayKeys = Object.keys(day);
        if (dayKeys.length !== 2 || !dayKeys.includes("name") || !dayKeys.includes("workoutId")) {
          setImportError(`Week ${i + 1} day entries must include only name and workoutId.`);
          return;
        }
        const dayName = (day as { name?: unknown }).name;
        const workoutId = (day as { workoutId?: unknown }).workoutId;
        if (!ALL_DAYS.includes(dayName as DayName)) {
          setImportError(`Week ${i + 1} contains an invalid day name.`);
          return;
        }
        if (seenDayNames.has(dayName as DayName)) {
          setImportError(`Week ${i + 1} contains duplicate day '${dayName}'.`);
          return;
        }
        seenDayNames.add(dayName as DayName);
        if (workoutId !== null && typeof workoutId !== "string") {
          setImportError(`Week ${i + 1} day '${dayName}' has an invalid workoutId.`);
          return;
        }
        if (typeof workoutId === "string" && !workoutIds.has(workoutId)) {
          setImportError(
            `Week ${i + 1} day '${dayName}' references missing workout '${workoutId}'.`
          );
          return;
        }
        normalizedDays.push({ name: dayName as DayName, workoutId });
      }

      const orderedDays = ALL_DAYS.map((d) => {
        const found = normalizedDays.find((day) => day.name === d);
        return found || { name: d, workoutId: null };
      });

      normalizedWeeks.push({ id, name: name.trim(), days: orderedDays });
    }

    setImportReady(true);
    setImportWeeks(normalizedWeeks);
  };

  const handleImport = () => {
    if (!importReady || !importWeeks) return;
    onRequestImportSplit(importWeeks);
    setImportOpen(false);
    resetImportState();
  };

  const handleAddWeek = () => {
    const id = onAddWeek();
    setOpenWeekIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setOpenKey(null);
    setScrollToWeekId(id);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-base font-semibold">Split Editor</div>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            className="px-3 py-2 rounded-xl bg-gray-100 text-sm font-semibold"
            onClick={handleAddWeek}
          >
            + Add Week
          </button>
          <button
            type="button"
            className="px-4 py-3 rounded-2xl bg-black text-white text-sm font-semibold"
            onClick={() => setExportOpen(true)}
          >
            Export Split
          </button>
          <button
            type="button"
            className="px-4 py-3 rounded-2xl bg-gray-100 text-sm font-semibold"
            onClick={() => {
              setImportOpen(true);
              resetImportState();
            }}
          >
            Import Split
          </button>
        </div>
      </div>

      {weeks.map((week) => {
        const isWeekOpen = openWeekIds.includes(week.id);
        const dayMap = new Map(week.days.map((d) => [d.name, d.workoutId] as const));

        return (
          <section
            key={week.id}
            id={`week-${week.id}`}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4"
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="h-11 w-11 rounded-2xl bg-gray-100 text-lg font-black"
              onClick={() => {
                setOpenWeekIds((prev) =>
                  prev.includes(week.id)
                    ? prev.filter((id) => id !== week.id)
                    : [...prev, week.id]
                );
                if (isWeekOpen && openKey?.startsWith(`${week.id}:`)) setOpenKey(null);
              }}
              >
                {isWeekOpen ? "−" : "+"}
              </button>
              <input
                value={week.name}
                onChange={(e) => onRenameWeek(week.id, e.target.value)}
                className="flex-1 h-11 px-3 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black font-semibold"
              />
              <button
                type="button"
                className="h-11 px-3 rounded-2xl bg-red-600 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => onDeleteWeek(week.id)}
                disabled={weeks.length <= 1}
              >
                Delete
              </button>
            </div>

            <div
              className={
                "grid transition-[grid-template-rows] duration-300 ease-out mt-3 " +
                (isWeekOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")
              }
            >
              <div
                className={
                  "overflow-hidden transition-all duration-300 ease-out " +
                  (isWeekOpen ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1")
                }
              >
                <div className="space-y-2">
                  {ALL_DAYS.map((day) => {
                    const workoutId = dayMap.get(day) ?? null;
                    const workout = workoutId ? workoutById.get(workoutId) || null : null;
                    const key = `${week.id}:${day}`;
                    const isOpen = openKey === key;
                    const availableExercises = workout
                      ? state.exercises.filter((ex) => !workout.exerciseIds.includes(ex.id))
                      : [];

                    return (
                      <div
                        key={day}
                        className="rounded-2xl border border-gray-100 bg-white overflow-hidden"
                      >
                        <button
                          type="button"
                          className="w-full min-h-[44px] px-3 py-3 flex items-center justify-between gap-3"
                          onClick={() => setOpenKey(isOpen ? null : key)}
                        >
                          <div className="text-sm font-semibold">{day}</div>
                          <div className="flex items-center gap-2">
                            <div className="text-xs text-gray-600 truncate max-w-[140px]">
                              {workout ? workout.name : "Rest"}
                            </div>
                            <div className="text-lg font-black leading-none">
                              {isOpen ? "−" : "+"}
                            </div>
                          </div>
                        </button>

                        <div
                          className={
                            "grid transition-[grid-template-rows] duration-300 ease-out " +
                            (isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")
                          }
                        >
                          <div
                            className={
                              "overflow-hidden transition-all duration-300 ease-out " +
                              (isOpen ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1")
                            }
                          >
                            <div className="px-3 pb-4">
                              <div className="mt-2">
                                <label className="flex flex-col gap-1 w-full">
                                  <span className="text-xs font-semibold text-gray-600">
                                    Workout
                                  </span>
                                  <select
                                    value={workoutId || ""}
                                    onChange={(e) => onSetDay(week.id, day, e.target.value || null)}
                                    className="w-full h-11 px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black"
                                  >
                                    {options.map((o) => (
                                      <option key={o.value} value={o.value}>
                                        {o.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </div>

                              {workout ? (
                                <div className="mt-3 space-y-2">
                                  <div className="flex items-center gap-2">
                                    <select
                                      value={addExerciseId}
                                      onChange={(e) => setAddExerciseId(e.target.value)}
                                      className="flex-1 h-11 px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black"
                                    >
                                      <option value="">Add exercise…</option>
                                      {availableExercises.map((ex) => (
                                        <option key={ex.id} value={ex.id}>
                                          {ex.name}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      className="h-11 px-4 rounded-xl bg-black text-white text-sm font-semibold"
                                      onClick={() => {
                                        if (!addExerciseId) return;
                                        onAddExerciseToWorkout(workout.id, addExerciseId);
                                        setAddExerciseId("");
                                      }}
                                      disabled={!addExerciseId}
                                    >
                                      Add
                                    </button>
                                  </div>

                                  {workout.exerciseIds.length === 0 ? (
                                    <div className="text-xs text-gray-600">No exercises yet.</div>
                                  ) : (
                                    workout.exerciseIds.map((exerciseId, idx) => {
                                      const ex = exercisesById.get(exerciseId);
                                      const repMin = ex?.repScheme.workRangeMin ?? 0;
                                      const repMax = ex?.repScheme.workRangeMax ?? 0;
                                      return (
                                        <div
                                          key={exerciseId}
                                          className="flex items-center justify-between gap-2 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2"
                                        >
                                          <div className="min-w-0">
                                            <div className="text-sm font-semibold truncate">
                                              {ex?.name || "Unknown"}
                                            </div>
                                            <div className="text-xs text-gray-600">
                                              {ex?.equipment || "machine"} • {repMin}-{repMax}
                                            </div>
                                          </div>
                                          <div className="flex gap-1">
                                            <button
                                              type="button"
                                              className="h-10 w-10 rounded-xl bg-white border border-gray-200 text-sm font-bold"
                                              onClick={() =>
                                                onReorderWorkoutExercise(workout.id, idx, idx - 1)
                                              }
                                              disabled={idx === 0}
                                              aria-label="Move up"
                                            >
                                              ↑
                                            </button>
                                            <button
                                              type="button"
                                              className="h-10 w-10 rounded-xl bg-white border border-gray-200 text-sm font-bold"
                                              onClick={() =>
                                                onReorderWorkoutExercise(workout.id, idx, idx + 1)
                                              }
                                              disabled={idx === workout.exerciseIds.length - 1}
                                              aria-label="Move down"
                                            >
                                              ↓
                                            </button>
                                            <button
                                              type="button"
                                              className="h-10 px-3 rounded-xl bg-white border border-gray-200 text-xs font-semibold text-red-600"
                                              onClick={() =>
                                                onRemoveExerciseFromWorkout(workout.id, exerciseId)
                                              }
                                            >
                                              Remove
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              ) : (
                                <div className="mt-3 text-xs text-gray-600">Rest day.</div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        );
      })}

      <ExportModal open={exportOpen} value={exportText} onClose={() => setExportOpen(false)} />
      <ImportModal
        open={importOpen}
        value={importText}
        error={importError}
        canImport={importReady}
        onChange={handleImportChange}
        onValidate={validateImport}
        onImport={handleImport}
        onClose={() => {
          setImportOpen(false);
          resetImportState();
        }}
      />
    </div>
  );
}
