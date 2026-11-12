type Props = { value: number; onChange?: (v: number) => void; size?: number };

export default function Stars({ value, onChange, size = 16 }: Props) {
  return (
    <div className={`stars${onChange ? " editable" : ""}`} style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={n <= value ? "on" : ""} disabled={!onChange}
          title={onChange ? (n === value ? "Clear rating" : `${n} star${n > 1 ? "s" : ""}`) : undefined}
          onClick={() => onChange?.(n === value ? 0 : n)}>★</button>
      ))}
    </div>
  );
}
