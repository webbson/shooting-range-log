import React from "react";
import ReactDOM from "react-dom/client";

// `npm run dev:mock` runs the UI in a plain browser with a fake Tauri IPC
// (src/mockIpc.ts) so the user-guide screenshots can be captured. The shim must
// install before App loads, hence the dynamic imports.
async function boot() {
  if (import.meta.env.VITE_MOCK_IPC) await import("./mockIpc");
  const { default: App } = await import("./App");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

boot();
