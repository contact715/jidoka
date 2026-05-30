# Skill: Voice Clone Three-Step Flow — Record, progress, preview

> Wave: wave-15  |  Status: active  |  Tags: voice, media-recorder, multi-step, animation, progress

---

## When to use

- Building a multi-step "record something, process it, show result" flow.
- Step 1 requires live microphone access (MediaRecorder API) with a waveform visualizer.
- Step 2 is a processing/cloning phase with animated status messages.
- Step 3 shows a preview action + primary CTA.

---

## Implementation guide

### Step 1 — State machine with a discriminated union

```ts
// VoiceCloneStudio.tsx:24
type CloneStep = "record" | "cloning" | "ready";
const [step, setStep] = useState<CloneStep>("record");
```

Never use `stepIndex: number`. A string union makes branches readable (`step === "cloning"`) and rules out invalid index values.

### Step 2 — MediaRecorder setup

```ts
// key refs
const mediaRecorderRef = useRef<MediaRecorder | null>(null);
const streamRef = useRef<MediaStream | null>(null);
const analyserRef = useRef<AnalyserNode | null>(null);
const rafRef = useRef<number>(0);
```

Always store the stream in a ref so `stopRecordingResources` can call `.getTracks().forEach(t => t.stop())`. Failing to stop tracks leaves the microphone indicator on in the browser.

```ts
// VoiceCloneStudio.tsx:60-67
const stopRecordingResources = useCallback(() => {
  cancelAnimationFrame(rafRef.current);
  if (timerRef.current) clearInterval(timerRef.current);
  streamRef.current?.getTracks().forEach((t) => t.stop());
  streamRef.current = null;
  mediaRecorderRef.current = null;
  analyserRef.current = null;
}, []);
```

### Step 3 — Live waveform via rAF loop

The analyser reads frequency data into a `Uint8Array` each animation frame. Use a ref for the tick function to avoid circular dependency (the callback calls `requestAnimationFrame(tickAnalyserRef.current)` instead of itself):

```ts
// VoiceCloneStudio.tsx:69-80
const tickAnalyser = useCallback(() => {
  if (!analyserRef.current) return;
  const buf = new Uint8Array(analyserRef.current.frequencyBinCount);
  analyserRef.current.getByteFrequencyData(buf);
  setAudioData(new Uint8Array(buf));
  rafRef.current = requestAnimationFrame(tickAnalyserRef.current);
}, []);

useEffect(() => {
  tickAnalyserRef.current = tickAnalyser;
}, [tickAnalyser]);
```

Pass `audioData` to `<VoiceEqualizer audioData={audioData} />` (from `components/chat/VoiceEqualizer.tsx`).

### Step 4 — Auto-stop at max duration

Use `setInterval` to track elapsed seconds. At `MAX_DURATION_SEC` (45s), call the stop handler automatically. Store the interval ref to clear it on manual stop.

```ts
const MAX_DURATION_SEC = 45;
const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

### Step 5 — Cloning step: cycling status messages

```ts
// VoiceCloneStudio.tsx:26-31
const CLONING_MESSAGES = [
  "Listening to your voice...",
  "Learning your cadence...",
  "Building voice profile...",
  "Finalizing clone...",
];
```

Use `setInterval` to cycle `msgIdx` every ~1s. Clear the interval when transitioning to "ready". Pair with a `<motion.div>` progress bar that transitions `width` from 0% to 100% over a fixed duration (4s for mock; wire to real API progress event when available).

### Step 6 — Animate step transitions with AnimatePresence

Wrap each step panel in `<AnimatePresence mode="wait">`. Each step component uses:

```tsx
initial={{ opacity: 0, y: 8 }}
animate={{ opacity: 1, y: 0 }}
exit={{ opacity: 0, y: -8 }}
transition={{ duration: 0.2 }}
```

---

## Example references

| What | File | Lines |
|------|------|-------|
| Full implementation | `components/voice/redesign/killer/VoiceCloneStudio.tsx` | L1–L200 |
| Step state machine | `components/voice/redesign/killer/VoiceCloneStudio.tsx` | L24, L44 |
| Ref cleanup pattern | `components/voice/redesign/killer/VoiceCloneStudio.tsx` | L60–L67 |
| rAF loop + tickRef | `components/voice/redesign/killer/VoiceCloneStudio.tsx` | L69–L80 |
| Cloning status messages | `components/voice/redesign/killer/VoiceCloneStudio.tsx` | L26–L31 |
| VoiceEqualizer component | `components/chat/VoiceEqualizer.tsx` | whole file |

---

## Anti-patterns / gotchas

- **Don't call `requestAnimationFrame(tickAnalyser)` directly inside `tickAnalyser`.** This creates a stale closure that captures the initial function reference. Use `rafRef.current = requestAnimationFrame(tickAnalyserRef.current)` and keep the ref in sync via `useEffect`.
- **Don't forget to stop MediaStream tracks.** Calling `mediaRecorder.stop()` alone does not release the microphone. You must call `stream.getTracks().forEach(t => t.stop())`.
- **Don't transition to "cloning" before the `ondataavailable` event fires.** The recording blob is delivered asynchronously; transition state only after collecting the audio chunks.
- **Don't use `useState` for the cloning progress value if it updates at 60fps.** Use a CSS transition on width driven by a fixed timer duration — it avoids 60fps React re-renders.

---

## Wave reference

First applied: wave-15 (#8 VoiceCloneStudio — F-02 Voice Clone flow).
