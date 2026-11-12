// Pointer-based drag and drop inside the window. WebKit's HTML5 drag and drop
// is unreliable in a Tauri window, so items and folders are dragged with mouse events.
// Drop targets mark themselves with a `data-drop` attribute.

export type DragPayload = { kind: "items"; ids: string[] } | { kind: "folder"; id: string };
export type DropDetail = { payload: DragPayload; target: string };

const THRESHOLD = 5;

export function beginDrag(e: React.MouseEvent, payload: () => DragPayload, label: () => string) {
  if (e.button !== 0) return;
  const sx = e.clientX, sy = e.clientY;
  let ghost: HTMLDivElement | null = null;
  let over: HTMLElement | null = null;
  let data: DragPayload | null = null;

  const accepts = (el: HTMLElement) =>
    !!data && (data.kind === "folder" ? el.dataset.drop !== (data as { id: string }).id : el.dataset.drop !== "__top");

  const move = (ev: MouseEvent) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
      data = payload();
      ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      ghost.textContent = label();
      document.body.appendChild(ghost);
      document.body.classList.add("dragging");
    }
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 12}px)`;
    const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-drop]") ?? null;
    const target = el && accepts(el) ? el : null;
    if (target !== over) {
      over?.classList.remove("drop");
      target?.classList.add("drop");
      over = target;
    }
  };

  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    if (!ghost) return;
    ghost.remove();
    document.body.classList.remove("dragging");
    over?.classList.remove("drop");
    // Swallow the click that follows a drag so it doesn't change the selection.
    const swallow = (c: MouseEvent) => c.stopPropagation();
    window.addEventListener("click", swallow, true);
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    if (over && data) {
      window.dispatchEvent(new CustomEvent<DropDetail>("hoard-drop", { detail: { payload: data, target: over.dataset.drop! } }));
    }
  };

  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}
