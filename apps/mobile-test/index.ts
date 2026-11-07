import { registerRootComponent } from "expo";

import App from "./App";

// Point d'entrée explicite (plutôt que expo/AppEntry) : expo/AppEntry importe "../../App" depuis son propre
// dossier, ce qui casse avec les symlinks de pnpm. registerRootComponent = AppRegistry.registerComponent("main").
registerRootComponent(App);
