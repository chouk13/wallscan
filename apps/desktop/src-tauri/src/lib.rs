// Côté Rust : uniquement fichiers, fenêtres, mises à jour. Le métier reste en TypeScript partagé.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("erreur au lancement de WallScan");
}
