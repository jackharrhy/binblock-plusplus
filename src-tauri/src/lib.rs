use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    Emitter, Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Build the Edit menu
            let undo = MenuItemBuilder::with_id("edit:undo", "Undo")
                .accelerator("CmdOrCtrl+Z")
                .build(app)?;
            let redo = MenuItemBuilder::with_id("edit:redo", "Redo")
                .accelerator("CmdOrCtrl+Shift+Z")
                .build(app)?;
            let clear = MenuItemBuilder::with_id("edit:clear", "Clear Grid").build(app)?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .item(&undo)
                .item(&redo)
                .separator()
                .item(&clear)
                .build()?;

            // Build the View menu
            let reset_view = MenuItemBuilder::with_id("view:reset", "Reset View")
                .accelerator("CmdOrCtrl+0")
                .build(app)?;

            let view_menu = SubmenuBuilder::new(app, "View").item(&reset_view).build()?;

            // Build the full menu bar
            let menu = MenuBuilder::new(app)
                .item(&PredefinedMenuItem::about(app, Some("binblock++"), None)?)
                .item(&edit_menu)
                .item(&view_menu)
                .build()?;

            app.set_menu(menu)?;

            // Handle menu events
            app.on_menu_event(move |app_handle, event| {
                let id = event.id().as_ref();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.emit("menu-event", id);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
