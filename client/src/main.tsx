import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ZoomProvider } from "./zoom";
import { applyTheme, loadTheme } from "./themes";

// Apply the saved theme before the first paint, so the page never flashes the default.
applyTheme(loadTheme());

createRoot(document.getElementById("root")!).render(<StrictMode>
    <ZoomProvider>
      <App />
    </ZoomProvider>
  </StrictMode>);