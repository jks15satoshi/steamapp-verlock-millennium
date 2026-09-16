std = "luajit"

globals = {
  "millennium",
  "logger",
  "set_build_info",
  "lock_app",
  "refresh_app",
  "unlock_app",
  "list_locked",
  "restore_all",
  "get_data_root",
  "set_data_root",
  "reapply_app",
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
