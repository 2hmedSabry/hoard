import { useEffect, useRef, useState } from "react";

type Props = { initial: string; onDone: (v: string | null) => void; placeholder?: string };

/** Small text box that commits on Enter or blur and cancels on Escape. */
export default function InlineEdit({ initial, onDone, placeholder }: Props) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (val: string | null) => { if (done.current) return; done.current = true; onDone(val); };
  return (
    <input
      ref={ref} className="inline-edit" value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(v.trim() || null);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={() => finish(v.trim() || null)}
    />
  );
}
