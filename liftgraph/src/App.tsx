import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * LiftGraph — phone-first workout tracker prototype
 * - Local-first storage (localStorage for prototype; swap to IndexedDB later)
 * - Clean + Dirty reps per set
 * - Smart progression suggestions
 * - Barbell UI: enter plates per side; app calculates total
 * - Sets-per-exercise integrated into exercise list (interactive)
 * - Edit reps later while keeping weight locked
 * - Drop sets (pick parent set; prefill weight; log reduced weight)
 * - List views (no bubbles)
 * - Danger Zone reset clears HISTORY ONLY
 *
 * V2 scheduling:
 * - Master workout library + Week 1 / Week 2 split (1 workout/day or Rest)
 * - Active week toggle (persisted)
 * - Today resolves from calendar day + active week
 *
 * Step 6 (Workout Editor):
 * - Edit workout name
 * - Add existing exercises
 * - Create new exercises (adds to master exercise list)
 * - Remove exercises from workout (history-safe)
 * - Reorder exercises (up/down)
 *
 * Step 2 (Phone prep):
 * - Sticky header w/ blur
 * - Touch-friendly controls
 * - Session exercise accordion (less scrolling)
 * - "Add to Home Screen" guidance + optional Wake Lock
 */

// ------------------------- Types -------------------------

type DayName =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

type Equipment = "db" | "barbell" | "machine" | "cable" | "bodyweight";

type RepScheme = {
  workRangeMin: number;
  workRangeMax: number;
  progressMinClean: number;
  progressMaxClean: number;
  dirtyPenalty: number;
  maxDirtyRatioToProgress: number;
};

type ExerciseSettings = {
  id: string;
  name: string;
  equipment: Equipment;
  repScheme: RepScheme;
  dbIncrementPerHand: number;
  barbellIncrementPerSide: number;
  otherIncrementTotal: number;
  barWeight: number;
};

// Legacy (kept for migration only)

type WorkoutTemplate = {
  id: string;
  name: string;
  day: DayName;
  exerciseIds: string[];
};

// V2

type WorkoutLibraryItem = {
  id: string;
  name: string;
  exerciseIds: string[];
};

type SplitWeek = {
  days: Record<DayName, string | null>; // workoutId or Rest
};

type Split = {
  week1: SplitWeek;
  week2: SplitWeek;
};

type AppSettings = {
  activeWeek: "week1" | "week2";
  keepScreenAwake?: boolean;
};

type Plate = 45 | 35 | 25 | 10 | 5 | 2.5;

type PlateCounts = Record<Plate, number>;

type SetKind = "normal" | "drop";

type SetEntry = {
  id: string;
  exerciseId: string;
  kind?: SetKind;
  parentSetId?: string;
  weight?: number; // DB per-hand; cable/machine total; bodyweight added
  barbellPlatesPerSide?: PlateCounts;
  cleanReps: number;
  dirtyReps: number;
  notes?: string;
  createdAt: number;
};

type SessionStatus = "active" | "completed" | "skipped";

type Session = {
  id: string;
  workoutId: string;
  dateISO: string;
  sets: SetEntry[];
  status: SessionStatus;
  startedAt?: number;
  endedAt?: number;
};

type PersistedState = {
  exercises: ExerciseSettings[];

  // Legacy schedule model (kept during migration)
  workouts: WorkoutTemplate[];

  // V2
  workoutLibrary?: WorkoutLibraryItem[];
  split?: Split;
  settings?: AppSettings;

  sessions: Session[];
};

// ------------------------- Seed Data -------------------------

function mkEx(id: string, name: string, equipment: Equipment): ExerciseSettings {
  return {
    id,
    name,
    equipment,
    repScheme: {
      workRangeMin: 5,
      workRangeMax: 10,
      progressMinClean: 10,
      progressMaxClean: 12,
      dirtyPenalty: 0.5,
      maxDirtyRatioToProgress: 0.2,
    },
    dbIncrementPerHand: 5,
    barbellIncrementPerSide: 10,
    otherIncrementTotal: 5,
    barWeight: 45,
  };
}

const SEED_EXERCISES: ExerciseSettings[] = [
  // Push (Mon)
  mkEx("db_incline_press", "DB Incline Press", "db"),
  mkEx("pec_fly", "Pec Fly", "machine"),
  mkEx("military_press", "Military Press", "db"),
  mkEx("skull_crushers", "Skull Crushers", "db"),
  mkEx("oh_tricep_raise", "Overhead Tricep Raise", "cable"),
  mkEx("cable_lateral_raise", "Cable Lateral Raise", "cable"),

  // Pull (Tue)
  mkEx("lat_pulldown", "Lat Pulldown", "cable"),
  mkEx("cs_tbar_row_db", "Chest Supported T-Bar Row (DB)", "db"),
  mkEx("close_grip_cable_row", "Close Grip Cable Row", "cable"),
  mkEx("reverse_fly", "Reverse Fly (Rear Delt)", "machine"),
  mkEx("preacher_curl", "Preacher Curl", "db"),
  mkEx("hammer_curl", "Hammer Curl", "db"),

  // Legs (Wed) — quad
  mkEx("squat", "Squat", "barbell"),
  mkEx("bulgarian_split_squat", "Bulgarian Split Squat", "db"),
  mkEx("hamstring_curl", "Hamstring Curl", "machine"),
  mkEx("leg_extension", "Leg Extension", "machine"),
  mkEx("calf_raise", "Calf Raise", "machine"),

  // Shoulders & Arms (Thu)
  mkEx("db_shoulder_press", "DB Shoulder Press", "db"),
  mkEx("db_preacher_curl", "DB Preacher Curl", "db"),
  mkEx("cable_hammer_curl", "Cable Hammer Curl", "cable"),
  mkEx("tricep_pushdown", "Tricep Pushdown", "cable"),

  // Chest & Back (Fri)
  mkEx("incline_bench_press", "Incline Bench Press", "barbell"),
  mkEx("dips", "Dips", "bodyweight"),
  mkEx("face_pull", "Face Pull", "cable"),

  // Legs (hamstrings)
  mkEx("romanian_deadlift", "Romanian Deadlift", "barbell"),
  mkEx("leg_press", "Leg Press", "machine"),
  mkEx("adductor_machine", "Adductor Machine", "machine"),
];

const SEED_WORKOUTS: WorkoutTemplate[] = [
  {
    id: "push",
    name: "Push",
    day: "Monday",
    exerciseIds: [
      "db_incline_press",
      "pec_fly",
      "military_press",
      "skull_crushers",
      "oh_tricep_raise",
      "cable_lateral_raise",
    ],
  },
  {
    id: "pull",
    name: "Pull",
    day: "Tuesday",
    exerciseIds: [
      "lat_pulldown",
      "cs_tbar_row_db",
      "close_grip_cable_row",
      "reverse_fly",
      "preacher_curl",
      "hammer_curl",
    ],
  },
  {
    id: "legs_quad",
    name: "Legs (Quads)",
    day: "Wednesday",
    exerciseIds: [
      "squat",
      "bulgarian_split_squat",
      "hamstring_curl",
      "leg_extension",
      "calf_raise",
    ],
  },
  {
    id: "shoulders_arms",
    name: "Shoulders & Arms",
    day: "Thursday",
    exerciseIds: [
      "db_shoulder_press",
      "db_preacher_curl",
      "skull_crushers",
      "cable_hammer_curl",
      "tricep_pushdown",
      "cable_lateral_raise",
    ],
  },
  {
    id: "chest_back",
    name: "Chest & Back",
    day: "Friday",
    exerciseIds: [
      "incline_bench_press",
      "cs_tbar_row_db",
      "dips",
      "lat_pulldown",
      "face_pull",
      "reverse_fly",
    ],
  },
];

// ------------------------- Helpers -------------------------

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

const ALL_DAYS: DayName[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function todayDayName(): DayName {
  const idx = new Date().getDay();
  const map: DayName[] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return map[idx];
}

function emptySplitWeek(): SplitWeek {
  return {
    days: {
      Monday: null,
      Tuesday: null,
      Wednesday: null,
      Thursday: null,
      Friday: null,
      Saturday: null,
      Sunday: null,
    },
  };
}

function cloneSplitWeek(w: SplitWeek): SplitWeek {
  return { days: { ...w.days } };
}

function ensureV2State(raw: PersistedState): PersistedState {
  if (raw.workoutLibrary && raw.split && raw.settings) return raw;

  const workoutLibrary: WorkoutLibraryItem[] = (raw.workouts || []).map((w) => ({
    id: w.id,
    name: w.name,
    exerciseIds: [...w.exerciseIds],
  }));

  const week1 = emptySplitWeek();
  for (const w of raw.workouts || []) {
    if (week1.days[w.day] == null) week1.days[w.day] = w.id;
  }
  const week2 = cloneSplitWeek(week1);

  return {
    ...raw,
    workoutLibrary,
    split: { week1, week2 },
    settings: { activeWeek: "week1" },
  };
}

function safeJsonParse<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

const PLATES: Plate[] = [45, 35, 25, 10, 5, 2.5];

function emptyPlateCounts(): PlateCounts {
  return { 45: 0, 35: 0, 25: 0, 10: 0, 5: 0, 2.5: 0 };
}

function platesPerSideToTotal(plates: PlateCounts, barWeight: number): number {
  const side = PLATES.reduce((sum, p) => sum + p * (plates[p] || 0), 0);
  return barWeight + side * 2;
}

function addPlateCounts(a: PlateCounts, b: PlateCounts): PlateCounts {
  const out = emptyPlateCounts();
  for (const p of PLATES) out[p] = (a[p] || 0) + (b[p] || 0);
  return out;
}

function platesForWeightPerSide(w: number): PlateCounts {
  let remaining = Math.round(w * 2) / 2;
  const out = emptyPlateCounts();
  for (const p of PLATES) {
    const count = Math.floor(remaining / p + 1e-9);
    if (count > 0) {
      out[p] = count;
      remaining = Math.round((remaining - count * p) * 2) / 2;
    }
  }
  return out;
}

function plateCountsToText(pc: PlateCounts): string {
  const parts: string[] = [];
  for (const p of PLATES) {
    const n = pc[p] || 0;
    if (n > 0) parts.push(n === 1 ? `${p}` : `${p}x${n}`);
  }
  return parts.length ? parts.join(" + ") : "0";
}

function formatWeight(n: number): string {
  return Number.isInteger(n) ? `${n}` : `${n.toFixed(1)}`;
}

function setTotalWeight(ex: ExerciseSettings, s: SetEntry): number {
  if (ex.equipment === "barbell" && s.barbellPlatesPerSide) {
    return platesPerSideToTotal(s.barbellPlatesPerSide, ex.barWeight);
  }
  if (ex.equipment === "db") return (s.weight ?? 0) * 2;
  return s.weight ?? 0;
}

function computeSuggestion(ex: ExerciseSettings, sets: SetEntry[]) {
  const relevant = sets.filter((s) => s.exerciseId === ex.id);
  if (relevant.length === 0) return null;

  const scored = relevant
    .map((s) => {
      const totalReps = s.cleanReps + s.dirtyReps;
      const dirtyRatio = totalReps === 0 ? 0 : s.dirtyReps / totalReps;
      const effectiveReps = s.cleanReps + s.dirtyReps * ex.repScheme.dirtyPenalty;
      const weightTotal = setTotalWeight(ex, s);
      return { s, totalReps, dirtyRatio, effectiveReps, weightTotal };
    })
    .sort((a, b) => b.effectiveReps - a.effectiveReps);

  const best = scored[0];
  const scheme = ex.repScheme;

  const canProgress =
    best.s.cleanReps >= scheme.progressMinClean &&
    best.dirtyRatio <= scheme.maxDirtyRatioToProgress;

  let action: "increase" | "hold" | "decrease" = "hold";
  let message = "";

  if (canProgress) {
    action = "increase";
    message = `Progress next time. You hit ${best.s.cleanReps} clean with low dirty reps.`;
  } else if (best.s.cleanReps < scheme.workRangeMin) {
    action = "decrease";
    message = `Below working range (${scheme.workRangeMin}-${scheme.workRangeMax}). Consider dropping weight or reps.`;
  } else if (best.dirtyRatio > scheme.maxDirtyRatioToProgress) {
    action = "hold";
    message = `Hold weight. Too many dirty reps (${Math.round(best.dirtyRatio * 100)}%). Convert dirty → clean first.`;
  } else {
    action = "hold";
    message = `Hold weight. Aim to add clean reps toward ${scheme.progressMinClean}-${scheme.progressMaxClean} clean.`;
  }

  const inc =
    ex.equipment === "db"
      ? ex.dbIncrementPerHand * 2
      : ex.equipment === "barbell"
      ? ex.barbellIncrementPerSide * 2
      : ex.otherIncrementTotal;

  const nextWeight =
    action === "increase"
      ? best.weightTotal + inc
      : action === "decrease"
      ? Math.max(0, best.weightTotal - inc)
      : best.weightTotal;

  const bestPlates =
    ex.equipment === "barbell" && best.s.barbellPlatesPerSide
      ? best.s.barbellPlatesPerSide
      : null;
  const deltaPerSide = ex.equipment === "barbell" ? ex.barbellIncrementPerSide : 0;
  const deltaPlatesPerSide =
    ex.equipment === "barbell" && action === "increase"
      ? platesForWeightPerSide(deltaPerSide)
      : null;
  const nextPlatesPerSide =
    ex.equipment === "barbell" && bestPlates && deltaPlatesPerSide
      ? addPlateCounts(bestPlates, deltaPlatesPerSide)
      : null;

  const formatNextWeight = () => {
    if (ex.equipment === "db") {
      const perHand = nextWeight / 2;
      return `${formatWeight(perHand)} per hand (${formatWeight(nextWeight)} total)`;
    }
    if (ex.equipment === "barbell") {
      if (action === "increase" && nextPlatesPerSide && deltaPlatesPerSide) {
        return `Add ${plateCountsToText(deltaPlatesPerSide)} per side → ${plateCountsToText(
          nextPlatesPerSide
        )} per side (Total ${formatWeight(nextWeight)})`;
      }
      return `${formatWeight(nextWeight)} total`;
    }
    return `${formatWeight(nextWeight)}`;
  };

  const formatCurrentWeight = () => {
    if (ex.equipment === "db") {
      const perHand = best.weightTotal / 2;
      return `${formatWeight(perHand)} per hand (${formatWeight(best.weightTotal)} total)`;
    }
    if (ex.equipment === "barbell") return `${formatWeight(best.weightTotal)} total`;
    return `${formatWeight(best.weightTotal)}`;
  };

  const nextGoal =
    action === "increase"
      ? `Next: ${formatNextWeight()} for ${scheme.workRangeMin}-${scheme.workRangeMax} (keep dirty ≤ ${Math.round(
          scheme.maxDirtyRatioToProgress * 100
        )}%).`
      : `Next: keep ${formatCurrentWeight()} and aim for ${scheme.progressMinClean}+ clean reps (dirty ≤ ${Math.round(
          scheme.maxDirtyRatioToProgress * 100
        )}%).`;

  return {
    best,
    action,
    nextWeight,
    inc,
    message,
    nextGoal,
    barbell:
      ex.equipment === "barbell"
        ? { bestPlates, deltaPlatesPerSide, nextPlatesPerSide }
        : null,
  };
}

type ResolvedWorkout = {
  id: string;
  name: string;
  exerciseIds: string[];
};

function resolveWorkoutForDay(
  st: PersistedState,
  day: DayName
): { workout: ResolvedWorkout | null; workoutId: string | null; activeWeek: "week1" | "week2" } {
  const activeWeek = st.settings?.activeWeek ?? "week1";

  const v2Id = st.split?.[activeWeek]?.days?.[day] ?? null;
  if (v2Id) {
    const w = st.workoutLibrary?.find((x) => x.id === v2Id) || null;
    if (w) return { workout: { ...w }, workoutId: w.id, activeWeek };
    return { workout: null, workoutId: null, activeWeek };
  }

  // Legacy fallback
  const legacy = st.workouts.find((w) => w.day === day) || null;
  if (!legacy) return { workout: null, workoutId: null, activeWeek };
  return {
    workout: { id: legacy.id, name: legacy.name, exerciseIds: legacy.exerciseIds },
    workoutId: legacy.id,
    activeWeek,
  };
}

function getWorkoutName(state: PersistedState, workoutId: string): string {
  return (
    state.workoutLibrary?.find((w) => w.id === workoutId)?.name ||
    state.workouts.find((w) => w.id === workoutId)?.name ||
    workoutId
  );
}

function getWorkoutExerciseIds(state: PersistedState, workoutId: string): string[] {
  return (
    state.workoutLibrary?.find((w) => w.id === workoutId)?.exerciseIds ||
    state.workouts.find((w) => w.id === workoutId)?.exerciseIds ||
    []
  );
}

function getLastSetForExercise(session: Session, exerciseId: string): SetEntry | null {
  const sets = session.sets
    .filter((s) => s.exerciseId === exerciseId)
    .sort((a, b) => b.createdAt - a.createdAt);
  return sets[0] || null;
}

// ------------------------- Storage -------------------------

const LS_KEY = "liftgraph_v1";

function loadState(): PersistedState {
  const raw = safeJsonParse<PersistedState>(localStorage.getItem(LS_KEY), {
    exercises: SEED_EXERCISES,
    workouts: SEED_WORKOUTS,
    sessions: [],
  });

  const migrated = ensureV2State(raw);

  const sessions = (migrated.sessions || []).map((s: any) => {
    if (!s.status) return { ...s, status: "active" as SessionStatus };
    return s as Session;
  });

  return { ...migrated, sessions };
}

function saveState(st: PersistedState) {
  localStorage.setItem(LS_KEY, JSON.stringify(st));
}

// ------------------------- UI primitives -------------------------

function BottomNav({
  tab,
  setTab,
}: {
  tab: "Today" | "Split" | "History" | "Settings";
  setTab: (t: "Today" | "Split" | "History" | "Settings") => void;
}) {
  const items: { key: typeof tab; label: string }[] = [
    { key: "Today", label: "Today" },
    { key: "Split", label: "Split" },
    { key: "History", label: "History" },
    { key: "Settings", label: "Settings" },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40">
      <div className="max-w-[520px] mx-auto px-4">
        <div className="bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70 border border-gray-200 shadow-sm rounded-3xl px-2 py-2 mb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-4 gap-2">
            {items.map((it) => (
              <button
                key={it.key}
                type="button"
                onClick={() => setTab(it.key)}
                className={
                  "h-12 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98] " +
                  (tab === it.key
                    ? "bg-black text-white"
                    : "bg-gray-100 text-gray-800")
                }
                aria-current={tab === it.key ? "page" : undefined}
              >
                {it.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}

function Card({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 transition-shadow duration-200">
      <div className="flex items-center justify-between mb-3">
        <div className="text-base font-semibold">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-2 py-1 rounded-full bg-gray-100 text-gray-700 text-xs">
      {children}
    </span>
  );
}

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:w-[520px] bg-white rounded-t-3xl sm:rounded-3xl p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">{title}</div>
          <button
            className="text-sm font-semibold px-3 py-2 rounded-xl bg-gray-100"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

type ConfirmState = {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
};

function ConfirmDialog({
  state,
  onClose,
}: {
  state: ConfirmState | null;
  onClose: () => void;
}) {
  if (!state || !state.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:w-[520px] bg-white rounded-t-3xl sm:rounded-3xl p-4 shadow-xl">
        <div className="text-lg font-semibold">{state.title}</div>
        <div className="mt-2 text-sm text-gray-700">{state.message}</div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="flex-1 px-4 py-3 rounded-2xl bg-gray-100 font-semibold"
            onClick={onClose}
          >
            {state.cancelText || "Cancel"}
          </button>
          <button
            type="button"
            className={
              "flex-1 px-4 py-3 rounded-2xl font-semibold text-white " +
              (state.danger ? "bg-red-600" : "bg-black")
            }
            onClick={() => {
              state.onConfirm();
              onClose();
            }}
          >
            {state.confirmText || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min = 0,
  inputMode = "decimal",
  center = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  center?: boolean;
}) {
  const [text, setText] = useState<string>(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  return (
    <label className="flex flex-col gap-1 w-full">
      <span className="text-xs font-semibold text-gray-600">{label}</span>
      <input
        type="text"
        inputMode={inputMode}
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          const trimmed = raw.trim();
          if (trimmed === "") return;
          const n = Number(trimmed);
          if (!Number.isFinite(n)) return;
          onChange(Math.max(min, n));
        }}
        onBlur={() => {
          if (text.trim() === "") {
            setText(String(value));
            return;
          }
          const n = Number(text);
          if (!Number.isFinite(n)) {
            setText(String(value));
            return;
          }
          const clamped = Math.max(min, n);
          onChange(clamped);
          setText(String(clamped));
        }}
        className={
          "px-3 py-2 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black w-full text-lg font-semibold " +
          (center ? "text-center" : "")
        }
        aria-label={label}
      />
    </label>
  );
}

function StepperInput({
  label,
  value,
  onChange,
  step,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step: number;
  min?: number;
}) {
  const [text, setText] = useState<string>(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const dec = () => onChange(Math.max(min, value - step));
  const inc = () => onChange(value + step);

  return (
    <label className="flex flex-col gap-1 w-full">
      <span className="text-xs font-semibold text-gray-600">{label}</span>
      <div className="flex items-stretch gap-3 w-full">
        <button
          type="button"
          onClick={dec}
          className="w-16 h-14 rounded-2xl bg-gray-100 font-black text-3xl flex items-center justify-center"
          aria-label={`decrease ${label}`}
        >
          −
        </button>
        <input
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            const trimmed = raw.trim();
            if (trimmed === "") return;
            const n = Number(trimmed);
            if (!Number.isFinite(n)) return;
            onChange(Math.max(min, n));
          }}
          onBlur={() => {
            if (text.trim() === "") {
              setText(String(value));
              return;
            }
            const n = Number(text);
            if (!Number.isFinite(n)) {
              setText(String(value));
              return;
            }
            const clamped = Math.max(min, n);
            onChange(clamped);
            setText(String(clamped));
          }}
          className="flex-1 px-3 py-2 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black text-center text-xl font-bold"
          aria-label={label}
        />
        <button
          type="button"
          onClick={inc}
          className="w-16 h-14 rounded-2xl bg-black text-white font-black text-3xl flex items-center justify-center"
          aria-label={`increase ${label}`}
        >
          +
        </button>
      </div>
      <div className="text-[11px] text-gray-500">Step: {step}</div>
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 w-full">
      <span className="text-xs font-semibold text-gray-600">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PlatesEditor({
  plates,
  setPlates,
}: {
  plates: PlateCounts;
  setPlates: (p: PlateCounts) => void;
}) {
  const update = (plate: Plate, delta: number) => {
    const next = { ...plates, [plate]: Math.max(0, (plates[plate] || 0) + delta) };
    setPlates(next);
  };

  return (
    <div className="grid grid-cols-3 gap-2">
      {PLATES.map((p) => (
        <div key={p} className="rounded-2xl border border-gray-200 p-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">{p}</div>
            <Pill>per side</Pill>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <button
              className="w-10 h-10 rounded-xl bg-gray-100 font-bold"
              onClick={() => update(p, -1)}
              aria-label={`remove ${p}`}
              type="button"
            >
              −
            </button>
            <div className="text-lg font-semibold tabular-nums">{plates[p] || 0}</div>
            <button
              className="w-10 h-10 rounded-xl bg-black text-white font-bold"
              onClick={() => update(p, +1)}
              aria-label={`add ${p}`}
              type="button"
            >
              +
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function useWakeLock(enabled: boolean) {
  const lockRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;

    const request = async () => {
      try {
        const navAny = navigator as any;
        if (!navAny.wakeLock?.request) return;
        lockRef.current = await navAny.wakeLock.request("screen");
        lockRef.current?.addEventListener?.("release", () => {
          lockRef.current = null;
        });
      } catch {
        // ignore (not supported / permissions)
      }
    };

    const release = async () => {
      try {
        await lockRef.current?.release?.();
      } catch {
        // ignore
      } finally {
        lockRef.current = null;
      }
    };

    if (enabled && !cancelled) request();
    if (!enabled) release();

    const onVis = () => {
      if (document.visibilityState === "visible" && enabled) request();
      if (document.visibilityState === "hidden") release();
    };

    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      release();
    };
  }, [enabled]);
}

// ------------------------- PWA (Step 3) -------------------------

type PWADisplayMode = "standalone" | "browser";

type PWAStatus = {
  displayMode: PWADisplayMode;
  manifestLinked: boolean;
  sw: "unsupported" | "registered" | "missing" | "failed" | "unknown";
};

function getPWADisplayMode(): PWADisplayMode {
  if (typeof window === "undefined") return "browser";
  const mm = window.matchMedia?.("(display-mode: standalone)");
  const isStandalone = !!mm?.matches || (navigator as any).standalone === true; // iOS Safari
  return isStandalone ? "standalone" : "browser";
}

function usePWASetup() {
  const [status, setStatus] = useState<PWAStatus>(() => ({
    displayMode: getPWADisplayMode(),
    manifestLinked: false,
    sw:
      typeof navigator !== "undefined" && "serviceWorker" in navigator
        ? "unknown"
        : "unsupported",
  }));

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Keep display mode fresh (some browsers flip after install without full reload)
    const mm = window.matchMedia?.("(display-mode: standalone)");
    const onMM = () => setStatus((s) => ({ ...s, displayMode: getPWADisplayMode() }));
    mm?.addEventListener?.("change", onMM);

    // Manifest link (expects real file at /manifest.webmanifest when hosted)
    const ensureManifestLink = async () => {
      try {
        const res = await fetch("/manifest.webmanifest", { method: "HEAD", cache: "no-store" });
        if (!res.ok) return;

        const existing = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
        if (existing) {
          existing.href = "/manifest.webmanifest";
        } else {
          const link = document.createElement("link");
          link.rel = "manifest";
          link.href = "/manifest.webmanifest";
          document.head.appendChild(link);
        }
        setStatus((s) => ({ ...s, manifestLinked: true }));
      } catch {
        // file not present (common in sandbox) — ignore
      }
    };

    // Service worker (expects real file at /sw.js when hosted)
    const ensureSW = async () => {
      try {
        if (!("serviceWorker" in navigator)) {
          setStatus((s) => ({ ...s, sw: "unsupported" }));
          return;
        }

        // If the file doesn't exist (common in sandbox), don't treat as failure.
        const head = await fetch("/sw.js", { method: "HEAD", cache: "no-store" });
        if (!head.ok) {
          setStatus((s) => ({ ...s, sw: "missing" }));
          return;
        }

        await navigator.serviceWorker.register("/sw.js");
        setStatus((s) => ({ ...s, sw: "registered" }));
      } catch {
        setStatus((s) => ({ ...s, sw: "failed" }));
      }
    };

    ensureManifestLink();
    ensureSW();

    return () => {
      mm?.removeEventListener?.("change", onMM);
    };
  }, []);

  return status;
}

// ------------------------- App -------------------------

type Screen =
  | { name: "home" }
  | { name: "session"; sessionId: string }
  | { name: "exercise"; exerciseId: string }
  | { name: "workoutEditor"; workoutId: string };

type AddSetDraft = {
  exerciseId: string;
  equipment: Equipment;
  weight?: number;
  barbellPlatesPerSide?: PlateCounts;
  cleanReps: number;
  dirtyReps: number;
  kind: SetKind;
  parentSetId?: string;
};

export default function App() {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const requestConfirm = (cfg: Omit<ConfirmState, "open">) => {
    setConfirmState({ ...cfg, open: true });
  };

  const closeConfirm = () => setConfirmState(null);

  const [tab, setTab] = useState<"Today" | "Split" | "History" | "Settings">("Today");
  const [screen, setScreen] = useState<Screen>({ name: "home" });

  const [state, setState] = useState<PersistedState>(() =>
    typeof window === "undefined"
      ? { exercises: SEED_EXERCISES, workouts: SEED_WORKOUTS, sessions: [] }
      : loadState()
  );

  useEffect(() => {
    if (typeof window !== "undefined") saveState(state);
  }, [state]);

  const keepAwake = !!state.settings?.keepScreenAwake;
  useWakeLock(keepAwake);

  const pwa = usePWASetup();

  const exercisesById = useMemo(() => {
    const m = new Map<string, ExerciseSettings>();
    state.exercises.forEach((e) => m.set(e.id, e));
    return m;
  }, [state.exercises]);

  const today = todayDayName();
  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const resolvedToday = useMemo(() => resolveWorkoutForDay(state, today), [state, today]);
  const todaysWorkout = resolvedToday.workout;
  const todaysWorkoutId = resolvedToday.workoutId;
  const activeWeek = resolvedToday.activeWeek;

  const activeSession = useMemo(() => {
    if (screen.name !== "session") return null;
    return state.sessions.find((s) => s.id === screen.sessionId) || null;
  }, [screen, state.sessions]);

  const todaysActiveSession = useMemo(() => {
    if (!todaysWorkoutId) return null;
    return (
      state.sessions.find(
        (s) =>
          s.workoutId === todaysWorkoutId &&
          s.dateISO === todayISO &&
          (s.status ?? "active") === "active"
      ) || null
    );
  }, [state.sessions, todaysWorkoutId, todayISO]);

  const openSession = (workoutId: string) => {
    const existing = state.sessions.find(
      (s) =>
        s.workoutId === workoutId &&
        s.dateISO === todayISO &&
        (s.status ?? "active") === "active"
    );
    if (existing) {
      setScreen({ name: "session", sessionId: existing.id });
      setTab("Today");
      return;
    }

    const next: Session = {
      id: uid("sess"),
      workoutId,
      dateISO: todayISO,
      sets: [],
      status: "active",
      startedAt: Date.now(),
    };

    setState((st) => ({ ...st, sessions: [next, ...st.sessions] }));
    setScreen({ name: "session", sessionId: next.id });
    setTab("Today");
  };

  const endSession = (sessionId: string, status: SessionStatus) => {
    setState((st) => ({
      ...st,
      sessions: st.sessions.map((s) =>
        s.id === sessionId ? { ...s, status, endedAt: Date.now() } : s
      ),
    }));
  };

  const addSet = (sessionId: string, setEntry: Omit<SetEntry, "id" | "createdAt">) => {
    setState((st) => ({
      ...st,
      sessions: st.sessions.map((s) => {
        if (s.id !== sessionId) return s;
        const nextSet: SetEntry = { ...setEntry, id: uid("set"), createdAt: Date.now() };
        return { ...s, sets: [nextSet, ...s.sets] };
      }),
    }));
  };

  const deleteSet = (sessionId: string, setId: string) => {
    setState((st) => ({
      ...st,
      sessions: st.sessions.map((s) =>
        s.id === sessionId ? { ...s, sets: s.sets.filter((x) => x.id !== setId) } : s
      ),
    }));
  };

  const updateSet = (
    sessionId: string,
    setId: string,
    patch: Partial<Pick<SetEntry, "cleanReps" | "dirtyReps" | "notes">>
  ) => {
    setState((st) => ({
      ...st,
      sessions: st.sessions.map((s) => {
        if (s.id !== sessionId) return s;
        return {
          ...s,
          sets: s.sets.map((x) => (x.id === setId ? { ...x, ...patch } : x)),
        };
      }),
    }));
  };

  const updateExerciseSettings = (exerciseId: string, patch: Partial<ExerciseSettings>) => {
    setState((st) => ({
      ...st,
      exercises: st.exercises.map((e) => (e.id === exerciseId ? { ...e, ...patch } : e)),
    }));
  };

  const updateWorkout = (workoutId: string, patch: Partial<WorkoutLibraryItem>) => {
    setState((st) => ({
      ...st,
      workoutLibrary: (st.workoutLibrary || []).map((w) =>
        w.id === workoutId ? { ...w, ...patch } : w
      ),
    }));
  };

  const createExercise = (name: string, equipment: Equipment): ExerciseSettings => {
    const ex: ExerciseSettings = mkEx(uid("ex"), name, equipment);
    setState((st) => ({ ...st, exercises: [ex, ...st.exercises] }));
    return ex;
  };

  const updateSplitDay = (week: "week1" | "week2", day: DayName, workoutId: string | null) => {
    setState((st) => {
      const v2 = ensureV2State(st);
      return {
        ...v2,
        split: {
          ...v2.split!,
          [week]: {
            days: { ...v2.split![week].days, [day]: workoutId },
          },
        },
      };
    });
  };

  const setActiveWeek = (w: "week1" | "week2") => {
    setState((st) => {
      const v2 = ensureV2State(st);
      return { ...v2, settings: { ...v2.settings!, activeWeek: w } };
    });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `liftgraph_backup_${todayISO}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    const text = await file.text();
    const parsed = safeJsonParse<PersistedState | null>(text, null);
    if (!parsed || !parsed.exercises || !parsed.workouts || !parsed.sessions) {
      alert("Invalid backup JSON.");
      return;
    }
    const migrated = ensureV2State(parsed);
    const sessions = (migrated.sessions || []).map((s: any) => ({
      ...s,
      status: (s.status || "active") as SessionStatus,
    }));
    setState({ ...migrated, sessions });
    alert("Imported.");
  };

  const resetHistory = () => {
    requestConfirm({
      title: "Reset history",
      message:
        "Are you sure you want to delete all workout history? This does not delete workouts or exercises.",
      confirmText: "Reset",
      cancelText: "Cancel",
      danger: true,
      onConfirm: () => {
        setState((st) => ({ ...st, sessions: [] }));
        setScreen({ name: "home" });
        setTab("Today");
      },
    });
  };

  const updateKeepAwake = (v: boolean) => {
    setState((st) => {
      const v2 = ensureV2State(st);
      return { ...v2, settings: { ...(v2.settings || { activeWeek: "week1" }), keepScreenAwake: v } };
    });
  };

  const settingsWeek = state.settings?.activeWeek ?? "week1";

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 selection:bg-black selection:text-white overscroll-none">
      <ConfirmDialog state={confirmState} onClose={closeConfirm} />

      <div className="max-w-[520px] mx-auto">
        <header className="sticky top-0 z-30">
          <div className="px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 bg-gray-50/80 backdrop-blur supports-[backdrop-filter]:bg-gray-50/70 border-b border-gray-100">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-2xl font-bold">LiftGraph</div>
                <div className="text-sm text-gray-600">Workout tracker + smart progression</div>
              </div>
              <div className="flex gap-2">
                <Pill>{today}</Pill>
                <Pill>{activeWeek === "week1" ? "Week 1" : "Week 2"}</Pill>
              </div>
            </div>
          </div>
        </header>

        <main className="px-4 pt-4 pb-[calc(7rem+env(safe-area-inset-bottom))]">
          {tab === "Today" && (
            <div className="space-y-4">
              {activeSession ? (
                <SessionView
                  state={state}
                  session={activeSession}
                  exercisesById={exercisesById}
                  onAddSet={addSet}
                  onDeleteSet={(sessionId, setId) =>
                    requestConfirm({
                      title: "Delete set",
                      message: "Are you sure you want to delete this set?",
                      confirmText: "Delete",
                      cancelText: "Cancel",
                      danger: true,
                      onConfirm: () => deleteSet(sessionId, setId),
                    })
                  }
                  onUpdateSet={updateSet}
                  onEndSession={(sessionId) =>
                    requestConfirm({
                      title: "End workout",
                      message: "Are you sure you want to end this workout? You can’t add more sets after ending.",
                      confirmText: "End workout",
                      cancelText: "Cancel",
                      danger: true,
                      onConfirm: () => endSession(sessionId, "completed"),
                    })
                  }
                  onOpenExercise={(id) => {
                    setScreen({ name: "exercise", exerciseId: id });
                    setTab("Settings");
                  }}
                />
              ) : (
                <>
                  {!todaysWorkout ? (
                    <Card title="No workout scheduled today">
                      <div className="text-sm text-gray-700">Today is {today}. Add a workout in Split.</div>
                    </Card>
                  ) : (
                    <Card title={todaysWorkout.name}>
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-600">Week: {activeWeek === "week1" ? "Week 1" : "Week 2"}</div>
                        <button
                          className="px-4 py-3 rounded-2xl bg-black text-white text-sm font-semibold active:scale-[0.97] transition-transform duration-100"
                          onClick={() => todaysWorkoutId && openSession(todaysWorkoutId)}
                          type="button"
                        >
                          {todaysActiveSession ? "Resume" : "Start"}
                        </button>
                      </div>
                      <div className="mt-3 text-sm text-gray-700">Exercises: {todaysWorkout.exerciseIds.length}</div>
                    </Card>
                  )}

                  <Card title="Quick Actions">
                    <div className="flex gap-2 flex-wrap">
                      <button
                        className="px-4 py-3 rounded-2xl bg-gray-100 text-sm font-semibold"
                        onClick={exportJson}
                        type="button"
                      >
                        Export JSON
                      </button>
                      <label className="px-4 py-3 rounded-2xl bg-gray-100 text-sm font-semibold cursor-pointer">
                        Import JSON
                        <input
                          type="file"
                          accept="application/json"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) importJson(f);
                            e.currentTarget.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </Card>
                </>
              )}
            </div>
          )}

          {tab === "Split" && (
            <div className="space-y-4">
              <Card
                title="Weekly Split"
                right={
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={
                        "px-3 py-2 rounded-xl text-sm font-semibold " +
                        (settingsWeek === "week1" ? "bg-black text-white" : "bg-gray-100")
                      }
                      onClick={() => setActiveWeek("week1")}
                    >
                      Week 1
                    </button>
                    <button
                      type="button"
                      className={
                        "px-3 py-2 rounded-xl text-sm font-semibold " +
                        (settingsWeek === "week2" ? "bg-black text-white" : "bg-gray-100")
                      }
                      onClick={() => setActiveWeek("week2")}
                    >
                      Week 2
                    </button>
                  </div>
                }
              >
                <SplitEditor
                  state={state}
                  week={settingsWeek}
                  onSetDay={(day, workoutId) => updateSplitDay(settingsWeek, day, workoutId)}
                />
              </Card>

              <Card title="Workout Library">
                <WorkoutLibrary
                  state={state}
                  onEdit={(workoutId) => {
                    setScreen({ name: "workoutEditor", workoutId });
                    setTab("Settings");
                  }}
                  onCreate={() => {
                    const id = uid("wk");
                    const w: WorkoutLibraryItem = { id, name: "New Workout", exerciseIds: [] };
                    setState((st) => {
                      const v2 = ensureV2State(st);
                      return { ...v2, workoutLibrary: [w, ...(v2.workoutLibrary || [])] };
                    });
                    setScreen({ name: "workoutEditor", workoutId: id });
                    setTab("Settings");
                  }}
                  onDelete={(workoutId) => {
                    requestConfirm({
                      title: "Delete workout",
                      message: "Are you sure you want to delete this workout from the library?",
                      confirmText: "Delete",
                      cancelText: "Cancel",
                      danger: true,
                      onConfirm: () => {
                        setState((st) => {
                          const v2 = ensureV2State(st);
                          const nextLib = (v2.workoutLibrary || []).filter((w) => w.id !== workoutId);
                          const nextSplit: Split = {
                            week1: { days: { ...v2.split!.week1.days } },
                            week2: { days: { ...v2.split!.week2.days } },
                          };
                          for (const d of ALL_DAYS) {
                            if (nextSplit.week1.days[d] === workoutId) nextSplit.week1.days[d] = null;
                            if (nextSplit.week2.days[d] === workoutId) nextSplit.week2.days[d] = null;
                          }
                          return { ...v2, workoutLibrary: nextLib, split: nextSplit };
                        });
                      },
                    });
                  }}
                />
              </Card>
            </div>
          )}

          {tab === "History" && (
            <div className="space-y-4">
              <HistoryView
                state={state}
                exercisesById={exercisesById}
                onOpenSession={(id) => {
                  setScreen({ name: "session", sessionId: id });
                  setTab("Today");
                }}
              />
            </div>
          )}

          {tab === "Settings" && (
            <div className="space-y-4">
              {screen.name === "workoutEditor" ? (
                <WorkoutEditor
                  workoutId={screen.workoutId}
                  state={state}
                  onBack={() => setScreen({ name: "home" })}
                  onUpdate={(id, patch) => updateWorkout(id, patch)}
                  onCreateExercise={createExercise}
                  onRequestRemoveExercise={(exerciseId) => {
                    requestConfirm({
                      title: "Remove exercise",
                      message: "Remove this exercise from the workout? History is preserved.",
                      confirmText: "Remove",
                      cancelText: "Cancel",
                      danger: true,
                      onConfirm: () => {
                        const w = (state.workoutLibrary || []).find((x) => x.id === screen.workoutId);
                        if (!w) return;
                        updateWorkout(screen.workoutId, {
                          exerciseIds: w.exerciseIds.filter((x) => x !== exerciseId),
                        });
                      },
                    });
                  }}
                />
              ) : screen.name === "exercise" ? (
                <ExerciseSettingsView
                  exercise={exercisesById.get(screen.exerciseId) || null}
                  onBack={() => setScreen({ name: "home" })}
                  onUpdate={updateExerciseSettings}
                />
              ) : (
                <>
                  <Card title="Phone settings">
                    <div className="space-y-3">
                      <label className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold">Keep screen awake</div>
                          <div className="text-xs text-gray-600">Prevents your phone screen from sleeping during a workout (if supported).</div>
                        </div>
                        <button
                          type="button"
                          className={
                            "px-4 py-3 rounded-2xl font-semibold active:scale-[0.98] transition-transform " +
                            (keepAwake ? "bg-black text-white" : "bg-gray-100")
                          }
                          onClick={() => updateKeepAwake(!keepAwake)}
                        >
                          {keepAwake ? "On" : "Off"}
                        </button>
                      </label>

                      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold">Add to Home Screen</div>
                          <Pill>{pwa.displayMode === "standalone" ? "Installed" : "Browser"}</Pill>
                        </div>
                        <div className="mt-1 text-xs text-gray-600">
                          iPhone (Safari): Share → “Add to Home Screen”.
                          <br />
                          Android (Chrome): Menu ⋮ → “Install app”.
                        </div>
                        <div className="mt-2 text-[11px] text-gray-500">
                          PWA status: Manifest {pwa.manifestLinked ? "found" : "missing"} • SW {pwa.sw}
                        </div>
                      </div>
                    </div>
                  </Card>

                  <Card title="Active Week">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={
                          "px-3 py-2 rounded-xl text-sm font-semibold " +
                          (settingsWeek === "week1" ? "bg-black text-white" : "bg-gray-100")
                        }
                        onClick={() => setActiveWeek("week1")}
                      >
                        Week 1
                      </button>
                      <button
                        type="button"
                        className={
                          "px-3 py-2 rounded-xl text-sm font-semibold " +
                          (settingsWeek === "week2" ? "bg-black text-white" : "bg-gray-100")
                        }
                        onClick={() => setActiveWeek("week2")}
                      >
                        Week 2
                      </button>
                    </div>
                  </Card>

                  <Card title="Exercise Settings">
                    <div className="space-y-2">
                      {state.exercises.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          className="w-full text-left px-3 py-3 rounded-2xl bg-gray-100 active:scale-[0.99] transition-transform"
                          onClick={() => setScreen({ name: "exercise", exerciseId: e.id })}
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-semibold">{e.name}</div>
                            <Pill>{e.equipment}</Pill>
                          </div>
                        </button>
                      ))}
                    </div>
                  </Card>

                  <Card title="Danger Zone" right={<Pill>History only</Pill>}>
                    <button
                      type="button"
                      className="w-full px-4 py-3 rounded-2xl bg-red-600 text-white font-semibold"
                      onClick={resetHistory}
                    >
                      Reset history
                    </button>
                    <div className="mt-2 text-xs text-gray-600">This does not delete workouts or exercises.</div>
                  </Card>
                </>
              )}
            </div>
          )}
        </main>
      </div>

      <BottomNav tab={tab} setTab={setTab} />
    </div>
  );
}

// ------------------------- Split Editor -------------------------

function SplitEditor({
  state,
  week,
  onSetDay,
}: {
  state: PersistedState;
  week: "week1" | "week2";
  onSetDay: (day: DayName, workoutId: string | null) => void;
}) {
  const lib = state.workoutLibrary || [];
  const split = state.split?.[week] || emptySplitWeek();

  const options = useMemo(() => {
    const base = [{ value: "", label: "Rest" }];
    const ws = lib.map((w) => ({ value: w.id, label: w.name }));
    return base.concat(ws);
  }, [lib]);

  return (
    <div className="space-y-3">
      {ALL_DAYS.map((d) => (
        <div key={d} className="flex items-center justify-between gap-3">
          <div className="w-28 font-semibold">{d}</div>
          <div className="flex-1">
            <Select
              label=""
              value={split.days[d] || ""}
              onChange={(v) => onSetDay(d, v ? v : null)}
              options={options}
            />
          </div>
        </div>
      ))}
      <div className="text-xs text-gray-600">
        By default, Week 2 starts as a copy of Week 1 and stays independent once edited.
      </div>
    </div>
  );
}

// ------------------------- Workout Library -------------------------

function WorkoutLibrary({
  state,
  onEdit,
  onCreate,
  onDelete,
}: {
  state: PersistedState;
  onEdit: (workoutId: string) => void;
  onCreate: () => void;
  onDelete: (workoutId: string) => void;
}) {
  const lib = state.workoutLibrary || [];
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="w-full px-4 py-3 rounded-2xl bg-black text-white font-semibold"
        onClick={onCreate}
      >
        + New workout
      </button>
      {lib.length === 0 ? (
        <div className="text-sm text-gray-600">No workouts yet.</div>
      ) : (
        lib.map((w) => (
          <div
            key={w.id}
            className="px-3 py-3 rounded-2xl bg-gray-100 flex items-center justify-between"
          >
            <div>
              <div className="font-semibold">{w.name}</div>
              <div className="text-xs text-gray-600">Exercises: {w.exerciseIds.length}</div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="px-3 py-2 rounded-xl bg-white text-sm font-semibold"
                onClick={() => onEdit(w.id)}
              >
                Edit
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-xl bg-white text-sm font-semibold text-red-600"
                onClick={() => onDelete(w.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ------------------------- Workout Editor (Step 6) -------------------------

function WorkoutEditor({
  workoutId,
  state,
  onBack,
  onUpdate,
  onCreateExercise,
  onRequestRemoveExercise,
}: {
  workoutId: string;
  state: PersistedState;
  onBack: () => void;
  onUpdate: (workoutId: string, patch: Partial<WorkoutLibraryItem>) => void;
  onCreateExercise: (name: string, equipment: Equipment) => ExerciseSettings;
  onRequestRemoveExercise: (exerciseId: string) => void;
}) {
  const workout = (state.workoutLibrary || []).find((w) => w.id === workoutId) || null;
  const exercises = state.exercises;

  const [name, setName] = useState<string>(workout?.name || "");
  const [pickId, setPickId] = useState<string>("");
  const [newName, setNewName] = useState<string>("");
  const [newEq, setNewEq] = useState<Equipment>("db");

  useEffect(() => {
    setName(workout?.name || "");
  }, [workout?.name]);

  if (!workout) {
    return (
      <div className="space-y-4">
        <Card
          title="Workout not found"
          right={
            <button className="px-3 py-2 rounded-xl bg-gray-100" onClick={onBack} type="button">
              Back
            </button>
          }
        >
          <div className="text-sm text-gray-700">This workout no longer exists.</div>
        </Card>
      </div>
    );
  }

  const used = new Set(workout.exerciseIds);
  const available = exercises
    .filter((e) => !used.has(e.id))
    .map((e) => ({ value: e.id, label: `${e.name} (${e.equipment})` }));

  const move = (idx: number, delta: number) => {
    const next = [...workout.exerciseIds];
    const j = idx + delta;
    if (j < 0 || j >= next.length) return;
    const tmp = next[idx];
    next[idx] = next[j];
    next[j] = tmp;
    onUpdate(workoutId, { exerciseIds: next });
  };

  const remove = (id: string) => {
    onRequestRemoveExercise(id);
  };

  const addExisting = () => {
    if (!pickId) return;
    if (workout.exerciseIds.includes(pickId)) return;
    onUpdate(workoutId, { exerciseIds: [...workout.exerciseIds, pickId] });
    setPickId("");
  };

  const createAndAdd = () => {
    const nm = newName.trim();
    if (!nm) return;
    const ex = onCreateExercise(nm, newEq);
    onUpdate(workoutId, { exerciseIds: [...workout.exerciseIds, ex.id] });
    setNewName("");
    setNewEq("db");
  };

  return (
    <div className="space-y-4">
      <Card
        title="Workout Editor"
        right={
          <button
            type="button"
            className="px-3 py-2 rounded-xl bg-gray-100 text-sm font-semibold"
            onClick={onBack}
          >
            Back
          </button>
        }
      >
        <div className="space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-600">Workout name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                const nm = name.trim();
                if (nm && nm !== workout.name) onUpdate(workoutId, { name: nm });
                if (!nm) setName(workout.name);
              }}
              className="px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black"
            />
          </label>
        </div>
      </Card>

      <Card title="Exercises (tap arrows to reorder)">
        {workout.exerciseIds.length === 0 ? (
          <div className="text-sm text-gray-600">No exercises yet.</div>
        ) : (
          <div className="space-y-2">
            {workout.exerciseIds.map((id, idx) => {
              const ex = state.exercises.find((e) => e.id === id);
              return (
                <div
                  key={id}
                  className="px-3 py-3 rounded-2xl bg-gray-100 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{ex?.name || id}</div>
                    <div className="text-xs text-gray-600">{ex?.equipment || ""}</div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={
                        "w-12 h-11 rounded-xl text-sm font-extrabold flex items-center justify-center transition-all " +
                        (idx === 0
                          ? "bg-gray-50 text-gray-300 cursor-not-allowed"
                          : "bg-gray-100 text-gray-900 active:scale-[0.97]")
                      }
                      onClick={() => move(idx, -1)}
                      aria-label="move up"
                      disabled={idx === 0}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={
                        "w-12 h-11 rounded-xl text-sm font-extrabold flex items-center justify-center transition-all " +
                        (idx === workout.exerciseIds.length - 1
                          ? "bg-gray-50 text-gray-300 cursor-not-allowed"
                          : "bg-gray-100 text-gray-900 active:scale-[0.97]")
                      }
                      onClick={() => move(idx, 1)}
                      aria-label="move down"
                      disabled={idx === workout.exerciseIds.length - 1}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-xl bg-white text-sm font-semibold"
                      onClick={() => remove(id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Add existing exercise">
        {available.length === 0 ? (
          <div className="text-sm text-gray-600 italic">All exercises are already in this workout.</div>
        ) : (
          <div className="space-y-3">
            <Select
              label="Exercise"
              value={pickId}
              onChange={setPickId}
              options={[{ value: "", label: "Select" }, ...available]}
            />
            <button
              type="button"
              className="w-full px-4 py-3 rounded-2xl bg-black text-white font-semibold active:scale-[0.97] transition-transform duration-100"
              onClick={addExisting}
              disabled={!pickId}
            >
              Add to workout
            </button>
          </div>
        )}
      </Card>

      <Card title="Create new exercise">
        <div className="space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-600">Exercise name</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g., Cable Row"
              className="px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black"
            />
          </label>
          <Select
            label="Equipment"
            value={newEq}
            onChange={(v) => setNewEq(v as Equipment)}
            options={[
              { value: "db", label: "Dumbbell" },
              { value: "barbell", label: "Barbell" },
              { value: "cable", label: "Cable" },
              { value: "machine", label: "Machine" },
              { value: "bodyweight", label: "Bodyweight" },
            ]}
          />
          <button
            type="button"
            className="w-full px-4 py-3 rounded-2xl bg-black text-white font-semibold active:scale-[0.97] transition-transform duration-100"
            onClick={createAndAdd}
            disabled={!newName.trim()}
          >
            Create + add
          </button>
        </div>
      </Card>
    </div>
  );
}

// ------------------------- Session View -------------------------

function SessionView({
  state,
  session,
  exercisesById,
  onAddSet,
  onDeleteSet,
  onUpdateSet,
  onEndSession,
  onOpenExercise,
}: {
  state: PersistedState;
  session: Session;
  exercisesById: Map<string, ExerciseSettings>;
  onAddSet: (sessionId: string, setEntry: Omit<SetEntry, "id" | "createdAt">) => void;
  onDeleteSet: (sessionId: string, setId: string) => void;
  onUpdateSet: (
    sessionId: string,
    setId: string,
    patch: Partial<Pick<SetEntry, "cleanReps" | "dirtyReps" | "notes">>
  ) => void;
  onEndSession: (sessionId: string) => void;
  onOpenExercise: (id: string) => void;
}) {
  const workoutName = getWorkoutName(state, session.workoutId);
  const workoutExerciseIds = getWorkoutExerciseIds(state, session.workoutId);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [draft, setDraft] = useState<AddSetDraft | null>(null);

  const [openExerciseId, setOpenExerciseId] = useState<string | null>(() => {
    // default open: first exercise when active, otherwise none
    return session.status === "active" ? (workoutExerciseIds[0] || null) : null;
  });

  useEffect(() => {
    if (session.status !== "active") return;
    if (openExerciseId) return;
    if (workoutExerciseIds[0]) setOpenExerciseId(workoutExerciseIds[0]);
  }, [session.status, openExerciseId, workoutExerciseIds]);

  const startMs = session.startedAt || session.endedAt || Date.now();
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed =
    session.status === "active"
      ? nowTick - startMs
      : (session.endedAt || startMs) - startMs;

  const openAddFor = (exerciseId: string, kind: SetKind, parentSetId?: string) => {
    const ex = exercisesById.get(exerciseId);
    if (!ex) return;
    const base: AddSetDraft = {
      exerciseId,
      equipment: ex.equipment,
      cleanReps: 8,
      dirtyReps: 0,
      kind,
      parentSetId,
    };

    const prev = session.sets.find((s) => s.exerciseId === exerciseId);
    if (prev) {
      if (ex.equipment === "barbell" && prev.barbellPlatesPerSide) {
        base.barbellPlatesPerSide = { ...prev.barbellPlatesPerSide };
      } else {
        base.weight = prev.weight;
      }
    } else {
      if (ex.equipment === "barbell") base.barbellPlatesPerSide = emptyPlateCounts();
      else base.weight = 0;
    }

    if (kind === "drop" && parentSetId) {
      const parent = session.sets.find((s) => s.id === parentSetId);
      if (parent) {
        if (ex.equipment === "barbell" && parent.barbellPlatesPerSide) {
          base.barbellPlatesPerSide = { ...parent.barbellPlatesPerSide };
        } else {
          base.weight = parent.weight;
        }
      }
    }

    setDraft(base);
    setAddModalOpen(true);
  };

  const addNow = () => {
    if (!draft) return;
    const ex = exercisesById.get(draft.exerciseId);
    if (!ex) return;

    onAddSet(session.id, {
      exerciseId: draft.exerciseId,
      kind: draft.kind,
      parentSetId: draft.kind === "drop" ? draft.parentSetId : undefined,
      weight: ex.equipment === "barbell" ? undefined : draft.weight ?? 0,
      barbellPlatesPerSide: ex.equipment === "barbell" ? draft.barbellPlatesPerSide : undefined,
      cleanReps: draft.cleanReps,
      dirtyReps: draft.dirtyReps,
      notes: "",
    });

    setAddModalOpen(false);
    setDraft(null);
  };

  const setsForExercise = (exerciseId: string) =>
    session.sets
      .filter((s) => s.exerciseId === exerciseId)
      .sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div className="space-y-4">
      <Card
        title={workoutName}
        right={
          <Pill>
            {session.status === "active" ? `Elapsed ${fmtDuration(elapsed)}` : session.status}
          </Pill>
        }
      >
        <div className="flex gap-2 flex-wrap">
          {session.status === "active" ? (
            <>
              <button
                type="button"
                className="px-4 py-3 rounded-2xl bg-red-600 text-white text-sm font-semibold"
                onClick={() => onEndSession(session.id)}
              >
                End workout
              </button>
            </>
          ) : (
            <div className="text-sm text-gray-700">Session ended.</div>
          )}
        </div>
      </Card>

      <div className="space-y-2">
        {workoutExerciseIds.map((exerciseId) => {
          const ex = exercisesById.get(exerciseId);
          if (!ex) return null;

          const sets = setsForExercise(exerciseId);
          const suggestion = computeSuggestion(ex, session.sets);
          const expanded = openExerciseId === exerciseId;
          const last = getLastSetForExercise(session, exerciseId);

          const summary = (() => {
            if (!last) return "No sets";
            const total = setTotalWeight(ex, last);
            const wTxt = ex.equipment === "db" ? `${formatWeight(last.weight ?? 0)}/hand` : `${formatWeight(total)}`;
            const repTxt = `${last.cleanReps}C + ${last.dirtyReps}D`;
            return `${wTxt} • ${repTxt}`;
          })();

          return (
            <div key={exerciseId} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <button
                type="button"
                className="w-full px-4 py-4 flex items-center justify-between gap-3 active:scale-[0.995] transition-transform"
                onClick={() => setOpenExerciseId(expanded ? null : exerciseId)}
                aria-expanded={expanded}
              >
                <div className="min-w-0 text-left">
                  <div className="font-semibold truncate">{ex.name}</div>
                  <div className="text-xs text-gray-600 mt-1">{summary}</div>
                </div>
                <div className="flex items-center gap-2">
                  {suggestion ? (
                    <Pill>
                      {suggestion.action === "increase"
                        ? "↑"
                        : suggestion.action === "decrease"
                        ? "↓"
                        : "="}
                    </Pill>
                  ) : null}
                  <div className="text-lg font-black leading-none">{expanded ? "−" : "+"}</div>
                </div>
              </button>

              {expanded ? (
                <div className="px-4 pb-4">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      className="px-3 py-2 rounded-xl bg-gray-100 text-sm font-semibold"
                      onClick={() => onOpenExercise(ex.id)}
                    >
                      Settings
                    </button>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="px-4 py-3 rounded-2xl bg-black text-white text-sm font-semibold"
                        onClick={() => openAddFor(ex.id, "normal")}
                        disabled={session.status !== "active"}
                      >
                        + Set
                      </button>
                      {sets.length > 0 ? (
                        <button
                          type="button"
                          className="px-4 py-3 rounded-2xl bg-gray-100 text-sm font-semibold"
                          onClick={() => openAddFor(ex.id, "drop", sets[sets.length - 1].id)}
                          disabled={session.status !== "active"}
                        >
                          + Drop
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {suggestion ? (
                    <div className="mt-3 rounded-2xl bg-gray-50 border border-gray-200 p-3">
                      <div className="text-sm font-semibold">
                        {suggestion.action === "increase"
                          ? "↑ Progress"
                          : suggestion.action === "decrease"
                          ? "↓ Adjust"
                          : "Hold"}
                      </div>
                      <div className="text-sm text-gray-700 mt-1">{suggestion.message}</div>
                      <div className="text-xs text-gray-600 mt-1">{suggestion.nextGoal}</div>
                    </div>
                  ) : (
                    <div className="mt-3 text-sm text-gray-600">Log a set to get suggestions.</div>
                  )}

                  <div className="mt-3 space-y-2">
                    {sets.length === 0 ? (
                      <div className="text-sm text-gray-600">No sets yet.</div>
                    ) : (
                      sets
                        .slice()
                        .reverse()
                        .map((s, idx) => (
                          <SetRow
                            key={s.id}
                            index={sets.length - idx}
                            exercise={ex}
                            set={s}
                            onDelete={() => onDeleteSet(session.id, s.id)}
                            onUpdate={(patch) => onUpdateSet(session.id, s.id, patch)}
                            disabled={session.status !== "active"}
                          />
                        ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <Modal open={addModalOpen} title="Add set" onClose={() => setAddModalOpen(false)}>
        {!draft ? null : (
          <AddSetForm
            draft={draft}
            exercise={exercisesById.get(draft.exerciseId) || null}
            onChange={setDraft}
            onAdd={addNow}
          />
        )}
      </Modal>
    </div>
  );
}

function SetRow({
  index,
  exercise,
  set,
  onDelete,
  onUpdate,
  disabled,
}: {
  index: number;
  exercise: ExerciseSettings;
  set: SetEntry;
  onDelete: () => void;
  onUpdate: (patch: Partial<Pick<SetEntry, "cleanReps" | "dirtyReps" | "notes">>) => void;
  disabled: boolean;
}) {
  const weightText = () => {
    if (exercise.equipment === "barbell" && set.barbellPlatesPerSide) {
      const total = platesPerSideToTotal(set.barbellPlatesPerSide, exercise.barWeight);
      return `${formatWeight(total)} (${plateCountsToText(set.barbellPlatesPerSide)} / side)`;
    }
    if (exercise.equipment === "db") return `${formatWeight(set.weight ?? 0)} / hand`;
    if (exercise.equipment === "bodyweight")
      return set.weight ? `BW + ${formatWeight(set.weight)}` : "BW";
    return `${formatWeight(set.weight ?? 0)}`;
  };

  return (
    <div className="rounded-2xl bg-gray-50 border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          Set {index} {set.kind === "drop" ? <Pill>Drop</Pill> : null}
        </div>
        <button
          type="button"
          className="px-4 py-3 rounded-2xl bg-white text-sm font-semibold text-red-600"
          onClick={onDelete}
          disabled={disabled}
        >
          Delete
        </button>
      </div>
      <div className="mt-2 text-sm text-gray-800">{weightText()}</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <NumberInput
          label="Clean reps"
          value={set.cleanReps}
          onChange={(n) => onUpdate({ cleanReps: Math.max(0, Math.floor(n)) })}
          min={0}
          inputMode="numeric"
          center
        />
        <NumberInput
          label="Dirty reps"
          value={set.dirtyReps}
          onChange={(n) => onUpdate({ dirtyReps: Math.max(0, Math.floor(n)) })}
          min={0}
          inputMode="numeric"
          center
        />
      </div>
    </div>
  );
}

function AddSetForm({
  draft,
  exercise,
  onChange,
  onAdd,
}: {
  draft: AddSetDraft;
  exercise: ExerciseSettings | null;
  onChange: (d: AddSetDraft) => void;
  onAdd: () => void;
}) {
  if (!exercise) return <div className="text-sm text-gray-700">Exercise not found.</div>;

  const isBarbell = exercise.equipment === "barbell";

  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-700">
        <span className="font-semibold">{exercise.name}</span> <Pill>{draft.kind}</Pill>
      </div>

      {isBarbell ? (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-600">Plates per side</div>
          <PlatesEditor
            plates={draft.barbellPlatesPerSide || emptyPlateCounts()}
            setPlates={(p) => onChange({ ...draft, barbellPlatesPerSide: p })}
          />
          <div className="text-sm text-gray-700">
            Total:{" "}
            {formatWeight(
              platesPerSideToTotal(
                draft.barbellPlatesPerSide || emptyPlateCounts(),
                exercise.barWeight
              )
            )}
          </div>
        </div>
      ) : exercise.equipment === "db" ? (
        <StepperInput
          label="Weight per hand"
          value={draft.weight ?? 0}
          onChange={(n) => onChange({ ...draft, weight: n })}
          step={exercise.dbIncrementPerHand}
          min={0}
        />
      ) : exercise.equipment === "bodyweight" ? (
        <NumberInput
          label="Added weight (optional)"
          value={draft.weight ?? 0}
          onChange={(n) => onChange({ ...draft, weight: n })}
          min={0}
          center
        />
      ) : (
        <StepperInput
          label="Weight"
          value={draft.weight ?? 0}
          onChange={(n) => onChange({ ...draft, weight: n })}
          step={exercise.otherIncrementTotal}
          min={0}
        />
      )}

      <div className="grid grid-cols-2 gap-3">
        <NumberInput
          label="Clean reps"
          value={draft.cleanReps}
          onChange={(n) => onChange({ ...draft, cleanReps: Math.max(0, Math.floor(n)) })}
          min={0}
          inputMode="numeric"
          center
        />
        <NumberInput
          label="Dirty reps"
          value={draft.dirtyReps}
          onChange={(n) => onChange({ ...draft, dirtyReps: Math.max(0, Math.floor(n)) })}
          min={0}
          inputMode="numeric"
          center
        />
      </div>

      <button
        type="button"
        className="w-full px-4 py-3 rounded-2xl bg-black text-white font-semibold active:scale-[0.97] transition-transform"
        onClick={onAdd}
      >
        Add set
      </button>
    </div>
  );
}

// ------------------------- Exercise Settings View -------------------------

function ExerciseSettingsView({
  exercise,
  onBack,
  onUpdate,
}: {
  exercise: ExerciseSettings | null;
  onBack: () => void;
  onUpdate: (exerciseId: string, patch: Partial<ExerciseSettings>) => void;
}) {
  if (!exercise) {
    return (
      <Card
        title="Exercise not found"
        right={
          <button className="px-3 py-2 rounded-xl bg-gray-100" onClick={onBack} type="button">
            Back
          </button>
        }
      >
        <div className="text-sm text-gray-700">This exercise no longer exists.</div>
      </Card>
    );
  }

  const eq = exercise.equipment;

  return (
    <div className="space-y-4">
      <Card
        title={exercise.name}
        right={
          <button
            type="button"
            className="px-3 py-2 rounded-xl bg-gray-100 text-sm font-semibold"
            onClick={onBack}
          >
            Back
          </button>
        }
      >
        <div className="flex gap-2">
          <Pill>{eq}</Pill>
        </div>
      </Card>

      <Card title="Progression">
        <div className="grid grid-cols-2 gap-3">
          <NumberInput
            label="Work range min"
            value={exercise.repScheme.workRangeMin}
            onChange={(n) =>
              onUpdate(exercise.id, {
                repScheme: { ...exercise.repScheme, workRangeMin: Math.max(0, Math.floor(n)) },
              })
            }
            min={0}
            inputMode="numeric"
            center
          />
          <NumberInput
            label="Work range max"
            value={exercise.repScheme.workRangeMax}
            onChange={(n) =>
              onUpdate(exercise.id, {
                repScheme: { ...exercise.repScheme, workRangeMax: Math.max(0, Math.floor(n)) },
              })
            }
            min={0}
            inputMode="numeric"
            center
          />
          <NumberInput
            label="Progress min clean"
            value={exercise.repScheme.progressMinClean}
            onChange={(n) =>
              onUpdate(exercise.id, {
                repScheme: { ...exercise.repScheme, progressMinClean: Math.max(0, Math.floor(n)) },
              })
            }
            min={0}
            inputMode="numeric"
            center
          />
          <NumberInput
            label="Max dirty ratio"
            value={Math.round(exercise.repScheme.maxDirtyRatioToProgress * 100)}
            onChange={(n) =>
              onUpdate(exercise.id, {
                repScheme: {
                  ...exercise.repScheme,
                  maxDirtyRatioToProgress: Math.max(0, Math.min(1, n / 100)),
                },
              })
            }
            min={0}
            inputMode="numeric"
            center
          />
        </div>
      </Card>

      {eq === "db" ? (
        <Card title="Dumbbell increments">
          <StepperInput
            label="Increment per hand"
            value={exercise.dbIncrementPerHand}
            onChange={(n) => onUpdate(exercise.id, { dbIncrementPerHand: Math.max(0, n) })}
            step={2.5}
            min={0}
          />
        </Card>
      ) : eq === "barbell" ? (
        <Card title="Barbell settings">
          <div className="grid grid-cols-2 gap-3">
            <NumberInput
              label="Bar weight"
              value={exercise.barWeight}
              onChange={(n) => onUpdate(exercise.id, { barWeight: Math.max(0, n) })}
              min={0}
              center
            />
            <NumberInput
              label="Increment per side"
              value={exercise.barbellIncrementPerSide}
              onChange={(n) => onUpdate(exercise.id, { barbellIncrementPerSide: Math.max(0, n) })}
              min={0}
              center
            />
          </div>
          <div className="text-xs text-gray-600 mt-2">Increment per side means +10 per side = +20 total.</div>
        </Card>
      ) : (
        <Card title="Machine/Cable increments">
          <NumberInput
            label="Increment"
            value={exercise.otherIncrementTotal}
            onChange={(n) => onUpdate(exercise.id, { otherIncrementTotal: Math.max(0, n) })}
            min={0}
            center
          />
        </Card>
      )}
    </div>
  );
}

// ------------------------- History View -------------------------

function HistoryView({
  state,
  exercisesById,
  onOpenSession,
}: {
  state: PersistedState;
  exercisesById: Map<string, ExerciseSettings>;
  onOpenSession: (sessionId: string) => void;
}) {
  void exercisesById; // reserved (future: per-exercise history rollups)

  const sessions = state.sessions
    .slice()
    .sort((a, b) => (b.endedAt || b.startedAt || 0) - (a.endedAt || a.startedAt || 0));

  if (sessions.length === 0) {
    return (
      <Card title="History">
        <div className="text-sm text-gray-700">No sessions yet.</div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((s) => {
        const name = getWorkoutName(state, s.workoutId);
        const dur = s.startedAt && s.endedAt ? fmtDuration(s.endedAt - s.startedAt) : "";
        const setCount = s.sets.length;
        return (
          <button
            key={s.id}
            type="button"
            className="w-full text-left px-3 py-3 rounded-2xl bg-white border border-gray-100 shadow-sm"
            onClick={() => onOpenSession(s.id)}
          >
            <div className="flex items-center justify-between">
              <div className="font-semibold">{name}</div>
              <Pill>{s.status}</Pill>
            </div>
            <div className="text-xs text-gray-600 mt-1">
              {s.dateISO} • Sets: {setCount}
              {dur ? ` • ${dur}` : ""}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------- Lightweight tests -------------------------

// PWA display mode test (pure)
function _test_getPWADisplayMode() {
  // cannot reliably force matchMedia here; just ensure return type is valid
  const v = getPWADisplayMode();
  assert(v === "browser" || v === "standalone", "getPWADisplayMode returns a valid mode");
}


function assert(cond: any, msg: string) {
  if (!cond) throw new Error(`Test failed: ${msg}`);
}

function runTestsOnce() {
  if (typeof window === "undefined") return;
  // @ts-ignore
  if (window.__LIFTGRAPH_TESTS_RAN__) return;
  // @ts-ignore
  window.__LIFTGRAPH_TESTS_RAN__ = true;

  const exDb = mkEx("t_db", "Test DB", "db");
  const exBb = mkEx("t_bb", "Test BB", "barbell");
  const exCable = mkEx("t_c", "Test Cable", "cable");

  const sess: Session = {
    id: "s",
    workoutId: "w",
    dateISO: "2025-01-01",
    sets: [],
    status: "active",
  };
  assert(sess.status === "active", "Session status should default to active");

  const normal: SetEntry = {
    id: "n",
    exerciseId: "t_c",
    weight: 100,
    cleanReps: 8,
    dirtyReps: 0,
    createdAt: 0,
  };
  assert((normal.kind ?? "normal") === "normal", "Default set kind should be normal");

  const drop: SetEntry = {
    id: "d",
    exerciseId: "t_c",
    kind: "drop",
    parentSetId: "n",
    weight: 80,
    cleanReps: 6,
    dirtyReps: 1,
    createdAt: 0,
  };
  assert(drop.kind === "drop" && drop.parentSetId === "n", "Drop set should store kind and parent");

  assert(
    setTotalWeight(exDb, {
      id: "s",
      exerciseId: "t_db",
      weight: 60,
      cleanReps: 10,
      dirtyReps: 0,
      createdAt: 0,
    }) === 120,
    "DB total weight should be per-hand * 2"
  );

  const plates: PlateCounts = { 45: 0, 35: 0, 25: 0, 10: 1, 5: 0, 2.5: 0 };
  assert(
    setTotalWeight(exBb, {
      id: "s",
      exerciseId: "t_bb",
      barbellPlatesPerSide: plates,
      cleanReps: 5,
      dirtyReps: 0,
      createdAt: 0,
    }) === 65,
    "Barbell total should include both sides + bar"
  );

  const sugg = computeSuggestion(exCable, [
    { id: "s", exerciseId: "t_c", weight: 100, cleanReps: 10, dirtyReps: 0, createdAt: 0 },
  ]);
  assert(sugg && sugg.action === "increase", "Should recommend increase at 10 clean, 0 dirty");

  const sugg2 = computeSuggestion(exCable, [
    { id: "s", exerciseId: "t_c", weight: 100, cleanReps: 10, dirtyReps: 5, createdAt: 0 },
  ]);
  assert(sugg2 && sugg2.action === "hold", "Should hold when dirty ratio is high");

  const exBb2 = mkEx("t_bb2", "Test BB2", "barbell");
  const sugg3 = computeSuggestion(exBb2, [
    {
      id: "s",
      exerciseId: "t_bb2",
      barbellPlatesPerSide: plates,
      cleanReps: 10,
      dirtyReps: 0,
      createdAt: 0,
    },
  ]);
  assert(sugg3 && sugg3.inc === 20, "Barbell increment should be 20 total by default");

  const combo = platesForWeightPerSide(15);
  assert(combo[10] === 1 && combo[5] === 1, "15 per side should decompose to 10 + 5");

  assert(
    typeof sugg3?.nextGoal === "string" && sugg3!.nextGoal.includes("per side"),
    "Barbell suggestion text should reference per side"
  );

  assert(
    plateCountsToText({ 45: 1, 35: 0, 25: 0, 10: 1, 5: 0, 2.5: 0 }) === "45 + 10",
    "plateCountsToText should format plate list"
  );

  assert(fmtDuration(0) === "0:00", "fmtDuration should format 0ms");
  assert(fmtDuration(61000) === "1:01", "fmtDuration should format 61s");

  // --- Migration tests (legacy -> v2 fields) ---
  const legacy: PersistedState = {
    exercises: [exDb, exBb, exCable],
    workouts: [
      { id: "w_mon", name: "Mon", day: "Monday", exerciseIds: ["t_db"] },
      { id: "w_wed_a", name: "Wed A", day: "Wednesday", exerciseIds: ["t_bb"] },
      { id: "w_wed_b", name: "Wed B", day: "Wednesday", exerciseIds: ["t_c"] },
    ],
    sessions: [],
  };

  const migrated = ensureV2State(legacy);
  assert(!!migrated.workoutLibrary, "Migration should create workoutLibrary");
  assert(!!migrated.split && !!migrated.settings, "Migration should create split + settings");
  assert(migrated.settings!.activeWeek === "week1", "activeWeek should default to week1");

  assert(migrated.split!.week1.days.Monday === "w_mon", "Week1 Monday should map to Monday workout");
  assert(
    migrated.split!.week1.days.Wednesday === "w_wed_a",
    "If duplicates exist, first encountered should be scheduled"
  );

  assert(
    JSON.stringify(migrated.split!.week2.days) === JSON.stringify(migrated.split!.week1.days),
    "Week2 should initially equal Week1"
  );

  const wk1Before = migrated.split!.week1.days.Monday;
  migrated.split!.week2.days.Monday = null;
  assert(
    migrated.split!.week1.days.Monday === wk1Before,
    "Week2 edits should not mutate Week1 (deep copy)"
  );

  assert(
    migrated.workoutLibrary!.some((w) => w.id === "w_wed_b"),
    "Unscheduled duplicate should remain in library"
  );

  // --- resolveWorkoutForDay uses split+activeWeek ---
  const st2: PersistedState = {
    exercises: [exDb],
    workouts: legacy.workouts,
    workoutLibrary: [
      { id: "w_mon", name: "Mon", exerciseIds: ["t_db"] },
      { id: "w_tue", name: "Tue", exerciseIds: ["t_db"] },
    ],
    split: {
      week1: { days: { ...emptySplitWeek().days, Monday: "w_mon", Tuesday: null } },
      week2: { days: { ...emptySplitWeek().days, Monday: "w_tue", Tuesday: null } },
    },
    settings: { activeWeek: "week2" },
    sessions: [],
  };

  const rMon = resolveWorkoutForDay(st2, "Monday");
  assert(rMon.workoutId === "w_tue", "resolveWorkoutForDay should respect activeWeek=week2");
  assert(rMon.workout?.name === "Tue", "resolveWorkoutForDay should resolve from workoutLibrary");

  _test_getPWADisplayMode();
}

runTestsOnce();
