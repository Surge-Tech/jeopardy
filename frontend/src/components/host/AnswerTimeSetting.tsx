import { useEffect, useState } from 'react';

export default function AnswerTimeSetting({ seconds, onChange, label = "Answer time", max = 120 }: { seconds: number; onChange: (seconds: number) => void; label?: string; max?: number }) {
  const [draft, setDraft] = useState(String(seconds));
  useEffect(() => { setDraft(String(seconds)); }, [seconds]);
  function save() {
    const value = Number(draft);
    if (draft !== '' && Number.isInteger(value) && value >= 0 && value <= max) {
      onChange(value);
    } else {
      setDraft(String(seconds));
    }
  }
  return (
    <label className="bg-gray-800 rounded px-3 py-1 text-sm flex items-center gap-2">
      <span className="text-gray-400">{label}:</span>
      <input type="number" min={0} max={max} step={1} aria-label={`${label} in seconds`}
        title="0 turns the countdown off. Changes apply to the next timer."
        className="bg-gray-700 text-white w-16 rounded px-2 py-1"
        value={draft} onChange={event => setDraft(event.target.value)} onBlur={save}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
      <span className="text-gray-400 text-xs">seconds (0 = off)</span>
    </label>
  );
}
