import { Text, View } from "react-native";
import { t } from "@wallscan/i18n";
/** Parcours Capturer → Mesurer → Visualiser → Chiffrer → Conclure : écrans en Phase 1 (mobile-engineer). */
export default function Home() {
  return <View><Text>{t("fr", "app.name")}</Text><Text>{t("fr", "flow.capture")}</Text></View>;
}
