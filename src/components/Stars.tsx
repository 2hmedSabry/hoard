import { t as tr, count } from "../i18n";
type Props = { value: number; onChange?: (v: number) => void; size?: number };

export default function Stars({ value, onChange, size = 16 }: Props) {
  return (
    <div className={`stars${onChange ? " editable" : ""}`} style={{ fontSize: size }} role="group" aria-label={tr("Rating")}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={n <= value ? "on" : ""} disabled={!onChange} aria-pressed={n <= value} aria-label={count(n, "1 star", "{n} stars")}
          title={onChange ? (n === value ? tr("Clear rating") : count(n, "1 star", "{n} stars")) : undefined}
          onClick={() => onChange?.(n === value ? 0 : n)}>★</button>
      ))}
    </div>
  );
}
