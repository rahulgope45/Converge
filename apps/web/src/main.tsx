import { createRoot } from "react-dom/client";

import App from "./App.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void registerOfflineShell();
  });
}

async function registerOfflineShell(): Promise<void> {
  const registration = await navigator.serviceWorker.register("/sw.js", {
    updateViaCache: "none",
  });
  await navigator.serviceWorker.ready;

  const resourceURLs = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((url) => {
      const resource = new URL(url);
      return (
        resource.origin === window.location.origin &&
        !resource.pathname.startsWith("/api/")
      );
    });

  registration.active?.postMessage({
    type: "CACHE_APP_RESOURCES",
    urls: resourceURLs,
  });
}
