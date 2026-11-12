import { t as tr } from "../i18n";
import { useEffect, useState } from "react";
import { flattenFolders } from "../api";
import type { Folder, Rule, SmartFolder } from "../types";

type Op = [string, string];
type Field = { label: string; ops: Op[]; input: "text" | "number" | "kind" | "folder" | "orientation" | "color" | "days"; unit?: string };

const TEXT_OPS: Op[] = [["contains", "contains"], ["not_contains", "doesn't contain"], ["is", "is"], ["is_not", "is not"],
  ["starts_with", "starts with"], ["ends_with", "ends with"], ["empty", "is empty"], ["not_empty", "is not empty"]];
const NUM_OPS: Op[] = [["gte", "is at least"], ["lte", "is at most"], ["eq", "is exactly"]];
const DATE_OPS: Op[] = [["within_days", "in the last"], ["older_than_days", "more than"]];

export const FIELDS: Record<string, Field> = {
  name: { label: "Name", ops: TEXT_OPS, input: "text" },
  tags: { label: "Tags", ops: [["has", "include"], ["not_has", "don't include"], ["contains", "contain text"], ["empty", "are empty"], ["not_empty", "are not empty"]], input: "text" },
  folder: { label: "Folder", ops: [["in", "is in"], ["not_in", "is not in"], ["empty", "is none (uncategorized)"], ["not_empty", "is any folder"]], input: "folder" },
  kind: { label: "Type", ops: [["is", "is"], ["is_not", "is not"]], input: "kind" },
  ext: { label: "Extension", ops: [["is", "is"], ["is_not", "is not"], ["contains", "contains"]], input: "text" },
  rating: { label: "Rating", ops: NUM_OPS, input: "number", unit: "stars" },
  width: { label: "Width", ops: NUM_OPS, input: "number", unit: "px" },
  height: { label: "Height", ops: NUM_OPS, input: "number", unit: "px" },
  orientation: { label: "Orientation", ops: [["is", "is"]], input: "orientation" },
  size: { label: "File size", ops: NUM_OPS, input: "number", unit: "MB" },
  duration: { label: "Length", ops: NUM_OPS, input: "number", unit: "seconds" },
  bpm: { label: "Tempo", ops: NUM_OPS, input: "number", unit: "BPM" },
  created: { label: "Date added", ops: DATE_OPS, input: "days", unit: "days" },
  modified: { label: "Date edited", ops: DATE_OPS, input: "days", unit: "days" },
  camera: { label: "Camera or lens", ops: [["contains", "contains"], ["not_contains", "doesn't contain"], ["is", "is"]], input: "text" },
  taken: { label: "Date taken", ops: DATE_OPS, input: "days", unit: "days" },
  color: { label: "Colour", ops: [["similar", "is similar to"]], input: "color" },
  note: { label: "Note", ops: TEXT_OPS, input: "text" },
  labels: { label: "Suggested labels", ops: [["has", "include"], ["not_has", "don't include"], ["contains", "contain text"]], input: "text" },
  ocr: { label: "Text in image", ops: TEXT_OPS, input: "text" },
  annotation: { label: "Area comments", ops: [["contains", "contain"], ["not_empty", "exist"], ["empty", "don't exist"]], input: "text" },
  url: { label: "Source link", ops: TEXT_OPS, input: "text" },
};
const NO_VALUE = new Set(["empty", "not_empty"]);
const KINDS = [["image", "Image"], ["video", "Video"], ["audio", "Audio"], ["document", "Document"], ["font", "Font"], ["other", "Other"]];

function defaultValue(field: string, folders: Folder[]) {
  const f = FIELDS[field];
  if (f.input === "kind") return "image";
  if (f.input === "orientation") return "landscape";
  if (f.input === "color") return "#0090ff";
  if (f.input === "folder") return flattenFolders(folders)[0]?.f.id ?? "";
  if (f.input === "days") return "7";
  return "";
}

type Props = {
  initial: SmartFolder | null; folders: Folder[];
  onSave: (name: string, matchMode: "all" | "any", rules: Rule[]) => void; onClose: () => void;
};

export default function SmartFolderEditor({ initial, folders, onSave, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [mode, setMode] = useState<"all" | "any">(initial?.matchMode ?? "all");
  const [rules, setRules] = useState<Rule[]>(initial?.rules.length ? initial.rules : [{ field: "tags", op: "has", value: "" }]);
  const flat = flattenFolders(folders);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const set = (i: number, patch: Partial<Rule>) => setRules((rs) => rs.map((r, j) => {
    if (j !== i) return r;
    const n = { ...r, ...patch };
    if (patch.field && patch.field !== r.field) { n.op = FIELDS[patch.field].ops[0][0]; n.value = defaultValue(patch.field, folders); }
    return n;
  }));

  const valid = name.trim() && rules.every((r) => NO_VALUE.has(r.op) || r.value.trim() !== "");

  const valueInput = (r: Rule, i: number) => {
    if (NO_VALUE.has(r.op)) return <span className="grow" />;
    const f = FIELDS[r.field];
    switch (f.input) {
      case "kind":
        return <select value={r.value} onChange={(e) => set(i, { value: e.target.value })}>{KINDS.map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}</select>;
      case "orientation":
        return <select value={r.value} onChange={(e) => set(i, { value: e.target.value })}>
          <option value="landscape">{tr("Landscape")}</option><option value="portrait">{tr("Portrait")}</option><option value="square">{tr("Square")}</option></select>;
      case "folder":
        return flat.length
          ? <select value={r.value} onChange={(e) => set(i, { value: e.target.value })}>{flat.map(({ f: fo, depth }) => <option key={fo.id} value={fo.id}>{"  ".repeat(depth)}{fo.name}</option>)}</select>
          : <span className="muted small">{tr("No folders yet")}</span>;
      case "color":
        return <input type="color" className="color-in" value={r.value} onChange={(e) => set(i, { value: e.target.value })} />;
      case "number":
      case "days":
        return <span className="num-in"><input type="number" min={0} step="any" value={r.value} onChange={(e) => set(i, { value: e.target.value })} />{f.unit && <span className="muted">{tr(f.unit)}</span>}</span>;
      default:
        return <input value={r.value} placeholder={tr("value")} onChange={(e) => set(i, { value: e.target.value })} />;
    }
  };

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{initial ? tr("Edit smart folder") : tr("New smart folder")}</h3>
        <p className="muted small">{tr("Items that match the rules show up here automatically.")}</p>
        <label className="field"><span>{tr("Name")}</span>
          <input autoFocus value={name} placeholder={tr("e.g. Unrated photos")} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="match-row">
          {tr("Show items that match")}
          <select value={mode} onChange={(e) => setMode(e.target.value as "all" | "any")}>
            <option value="all">{tr("all")}</option><option value="any">{tr("any")}</option>
          </select>
          {tr("of these rules:")}
        </div>
        <div className="rules">
          {rules.map((r, i) => (
            <div key={i} className="rule">
              <select value={r.field} onChange={(e) => set(i, { field: e.target.value })}>
                {Object.entries(FIELDS).map(([k, f]) => <option key={k} value={k}>{tr(f.label)}</option>)}
              </select>
              <select value={r.op} onChange={(e) => set(i, { op: e.target.value })}>
                {FIELDS[r.field].ops.map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}
              </select>
              {valueInput(r, i)}
              <button className="icon-btn" title={tr("Remove rule")} disabled={rules.length === 1}
                onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
        <button className="link add-rule" onClick={() => setRules((rs) => [...rs, { field: "name", op: "contains", value: "" }])}>{"＋ " + tr("Add rule")}</button>
        <div className="modal-actions">
          <button onClick={onClose}>{tr("Cancel")}</button>
          <button className="primary" disabled={!valid} onClick={() => onSave(name.trim(), mode, rules)}>{initial ? tr("Save") : tr("Create")}</button>
        </div>
      </div>
    </div>
  );
}
