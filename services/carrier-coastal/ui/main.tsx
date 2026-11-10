import { createRoot } from "react-dom/client";
import App from "./App";
import { getPortalSession } from "./api";
import "./styles.css";

// Open the portal session at page load; apiFetch requests one again if this fails.
getPortalSession().catch(() => {});

createRoot(document.getElementById("root")!).render(<App />);
