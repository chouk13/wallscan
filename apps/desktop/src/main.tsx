import { createRoot } from "react-dom/client";
import { t } from "@wallscan/i18n";
/** Mode showroom grand écran : Phase 1 (desktop-engineer). */
createRoot(document.getElementById("root")!).render(<h1>{t("fr", "app.name")} — showroom</h1>);
