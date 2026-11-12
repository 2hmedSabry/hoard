import { status } from "./hoard.js";

const token = document.getElementById("token");
const result = document.getElementById("result");

chrome.storage.local.get({ token: "" }).then((s) => { token.value = s.token; });

document.getElementById("connect").onclick = async () => {
  await chrome.storage.local.set({ token: token.value.trim() });
  result.textContent = "Checking…";
  result.style.color = "";
  try {
    const st = await status();
    result.textContent = st.library ? `Connected to “${st.library}”.` : "Connected. Open a library in Hoard to start saving.";
    result.style.color = "var(--ok)";
  } catch (e) {
    result.textContent = e.message;
    result.style.color = "var(--danger)";
  }
};
