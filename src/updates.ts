import { ask, message } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { t as tr } from "./i18n";

/** Looks for a newer signed release on GitHub and offers to install it. */
export async function checkForUpdates(fail: (e: unknown) => void) {
  try {
    const update = await check();
    if (!update) {
      await message(tr("You have the latest version of Hoard."), { title: tr("Check for updates") });
      return;
    }
    const ok = await ask(tr("Hoard {v} is available. Install it and restart now?", { v: update.version }) + (update.body ? `\n\n${update.body}` : ""),
      { title: tr("Update available"), okLabel: tr("Install and restart"), cancelLabel: tr("Later") });
    if (!ok) return;
    await update.downloadAndInstall();
    await relaunch();
  } catch (e) {
    fail(tr("Couldn't check for updates: {e}", { e: String(e) }));
  }
}
