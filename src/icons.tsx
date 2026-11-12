// Interface icons from Lucide (ISC licence). Older code refers to them by the
// text symbol they replaced, so `<I g="⌫" />` is the Trash icon.
import {
  ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, CircleDashed, Copy, Folder, FolderClosed, Hash, LayoutGrid,
  Lock, LockOpen, MoreHorizontal, Plus, Puzzle, RotateCcw, RotateCw, Search, Sparkles, Trash2, X, FlipHorizontal2,
  FlipVertical2, Undo2, type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  "◫": LayoutGrid, "◌": CircleDashed, "#": Hash, "⧉": Copy, "⌫": Trash2, "▢": Folder, "■": FolderClosed,
  "🔒": Lock, "🔓": LockOpen, "✦": Sparkles, "⧈": Puzzle, "▸": ChevronRight, "⋯": MoreHorizontal, "＋": Plus,
  "⌕": Search, "⌄": ChevronDown, "⟲": RotateCcw, "⟳": RotateCw, "⇋": FlipHorizontal2, "⇵": FlipVertical2,
  "↗": ArrowUpRight, "‹": ChevronLeft, "›": ChevronRight, "×": X, "↺": Undo2,
};

export function I({ g, size = 14, className }: { g: string; size?: number; className?: string }) {
  const C = MAP[g];
  if (!C) return <>{g}</>;
  return <C size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" className={`ic${className ? " " + className : ""}`} />;
}
