package = "steamapp-verlock"
version = "dev-1"

source = {
  url = ".",
}

build = {
  type = "builtin",
  modules = {},
}

dependencies = {
  "luacheck",
  "busted",
  "luacov",
}
