import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "./styles.css";
import { initTheme } from "./theme";

initTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);


