std = "luajit"

globals = {
  "millennium",
  "logger",
  "lock_app",
  "refresh_app",
  "get_required_apps",
  "unlock_app",
  "list_locked",
  "restore_all",
  "get_data_root",
  "get_paths",
  "open_path",
  "read_file",
  "set_data_root",
  "reapply_app",
  "append_log",
}

read_globals = {
  "MILLENNIUM_DECOMPRESS",
  "MILLENNIUM_PLUGIN_SECRET_NAME",
  "MILLENNIUM_PLUGIN_SECRET_BACKEND_ABSOLUTE",
}

exclude_files = {
  "node_modules/**",
  ".rocks/**",
  ".millennium/**",
}

files["backend/tests/**/*.lua"] = {
  std = "+busted",
}
