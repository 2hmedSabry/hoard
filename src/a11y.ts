// App-wide accessibility helpers, installed once from main.tsx.
// - Every dialog (.modal / .switcher inside .modal-back) is announced as a modal
//   dialog, keeps Tab focus inside, and gives focus back when it closes.
// - Elements with role="button" that aren't real buttons react to Enter/Space.

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function installA11y() {
  const returnTo = new WeakMap<Element, Element | null>();

  const prepare = (back: Element) => {
    const dlg = back.querySelector(".modal, .switcher");
    if (!dlg || dlg.getAttribute("role") === "dialog") return;
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    const heading = dlg.querySelector("h3, .plugin-head b");
    if (heading) {
      heading.id ||= "dlg-" + Math.random().toString(36).slice(2);
      dlg.setAttribute("aria-labelledby", heading.id);
    }
    returnTo.set(back, document.activeElement);
    requestAnimationFrame(() => {
      if (!dlg.contains(document.activeElement)) dlg.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    });
  };

  new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => { if (n instanceof Element) { if (n.matches(".modal-back")) prepare(n); n.querySelectorAll(".modal-back").forEach(prepare); } });
      r.removedNodes.forEach((n) => {
        if (n instanceof Element && n.matches(".modal-back")) {
          const back = returnTo.get(n);
          if (back instanceof HTMLElement && document.contains(back)) back.focus({ preventScroll: true });
        }
      });
    }
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if ((e.key === "Enter" || e.key === " ") && t.getAttribute?.("role") === "button" && t.tagName !== "BUTTON") {
      e.preventDefault();
      t.click();
      return;
    }
    if (e.key !== "Tab") return;
    const backs = document.querySelectorAll(".modal-back");
    const dlg = backs[backs.length - 1]?.querySelector(".modal, .switcher");
    if (!dlg) return;
    const items = [...dlg.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !dlg.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !dlg.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }, true);
}
