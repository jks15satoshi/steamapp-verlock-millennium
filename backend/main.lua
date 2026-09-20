local json = require("json")
local millennium = require("millennium")
local utils = require("utils")
local paths = require("paths")
local state = require("state")
local acf = require("acf")
local buildinfo = require("buildinfo")
local lock = require("lock")
local migrate = require("migrate")
local log = require("log")
local clock = require("clock")

---@param path string|nil
---@return string|nil
local function normalize(path)
    if type(path) ~= "string" then
        return path
    end
    local normalized = path:gsub("\\", "/")
    if normalized == "/" then
        return normalized
    end
    return (normalized:gsub("/+$", ""))
end

---@param appid any
---@return boolean
local function is_numeric_appid(appid)
    return type(appid) == "string" and appid:match("^%d+$") ~= nil
end

---@param appid string
---@return string
local function resolve_branch(appid)
    local manifest = paths.find_appmanifest(appid)
    if manifest == nil then
        return "public"
    end
    local state_table = acf.read(manifest)
    if state_table == nil then
        return "public"
    end
    local body = state_table.AppState or state_table
    if type(body.BetaKey) == "string" and body.BetaKey ~= "" then
        return body.BetaKey
    end
    return "public"
end

---@return void
local function clear_data_root_config()
    if type(millennium.config.delete) == "function" then
        millennium.config.delete("data_root")
    elseif type(millennium.config.set) == "function" then
        millennium.config.set("data_root", nil)
    end
end

local MAX_READ = 512 * 1024

---@param appid string
---@param target string
---@return string|nil, string|nil
local function resolve_target(appid, target)
    local record = state.read(appid)
    if target == "lock" then
        if record == nil then
            return nil, "the app has no lock record", "not_locked"
        end
        return state.path(appid)
    end
    local path
    if record ~= nil then
        path = record.manifest_path
    else
        path = paths.find_appmanifest(appid)
    end
    if path == nil then
        return nil, "the appmanifest was not found", "not_installed"
    end
    return path
end

local handlers = {}

---@param key string
---@param dump any
---@param branch string
---@return BuildInfo|nil, string|nil, string|nil
local function parse_dump(key, dump, branch)
    if type(dump) ~= "string" or dump == "" then
        return nil, "a build info dump is required for app " .. tostring(key), "build_info_required"
    end
    local info, parse_err, parse_code = buildinfo.parse(buildinfo.clean(dump), branch)
    if info == nil then
        return nil, parse_err, parse_code
    end
    local valid, valid_err, valid_code = buildinfo.validate(info)
    if not valid then
        return nil, valid_err, valid_code
    end
    return info
end

---@param appid string
---@param payload table
---@return BuildInfo|nil, string|nil, string|nil
local function collect_build_info(appid, payload)
    local dumps = payload.dumps
    if type(dumps) ~= "table" then
        return nil, "a build info dump is required", "build_info_required"
    end
    local base, base_err, base_code = parse_dump(appid, dumps[appid], resolve_branch(appid))
    if base == nil then
        return nil, base_err, base_code
    end
    local infos = { base }
    local keys = {}
    for key, dump in pairs(dumps) do
        if key ~= appid then
            if not is_numeric_appid(key) then
                return nil, "a numeric appid is required for every dump", "invalid_appid"
            end
            if type(dump) == "string" and dump ~= "" then
                table.insert(keys, key)
            end
        end
    end
    table.sort(keys)
    for _, key in ipairs(keys) do
        local info, info_err, info_code = parse_dump(key, dumps[key], resolve_branch(key))
        if info == nil then
            return nil, info_err, info_code
        end
        table.insert(infos, info)
    end
    return buildinfo.merge(infos)
end

handlers.lock_app = function(payload)
    local appid = payload.appid
    if not is_numeric_appid(appid) then
        return { ok = false, code = "invalid_appid", error = "a numeric appid is required" }
    end
    local auto_update_behavior = payload.auto_update_behavior
    if auto_update_behavior ~= nil and type(auto_update_behavior) ~= "number" then
        return { ok = false, code = "invalid_behavior", error = "the auto update behavior must be a number" }
    end
    local info, info_err, info_code = collect_build_info(appid, payload)
    if info == nil then
        log.error("lock failed for app " .. appid .. ": " .. tostring(info_err))
        return { ok = false, code = info_code, error = info_err }
    end
    return lock.lock(appid, info, auto_update_behavior)
end

handlers.refresh_app = function(payload)
    local appid = payload.appid
    if not is_numeric_appid(appid) then
        return { ok = false, code = "invalid_appid", error = "a numeric appid is required" }
    end
    local info, info_err, info_code = collect_build_info(appid, payload)
    if info == nil then
        log.error("refresh failed for app " .. appid .. ": " .. tostring(info_err))
        return { ok = false, code = info_code, error = info_err }
    end
    return lock.refresh(appid, info)
end

handlers.get_required_apps = function(payload)
    local appid = payload.appid
    if not is_numeric_appid(appid) then
        return { ok = false, code = "invalid_appid", error = "a numeric appid is required" }
    end
    if type(payload.dump) ~= "string" or payload.dump == "" then
        return { ok = false, code = "build_info_required", error = "a build info dump is required" }
    end
    local info, parse_err, parse_code = buildinfo.parse(buildinfo.clean(payload.dump), resolve_branch(appid))
    if info == nil then
        log.error("get_required_apps failed for app " .. appid .. ": " .. tostring(parse_err))
        return { ok = false, code = parse_code, error = parse_err }
    end
    local valid, valid_err, valid_code = buildinfo.validate(info)
    if not valid then
        log.error("get_required_apps failed for app " .. appid .. ": " .. tostring(valid_err))
        return { ok = false, code = valid_code, error = valid_err }
    end
    local apps, apps_err, apps_code = lock.required_apps(appid, info)
    if apps == nil then
        log.error("get_required_apps failed for app " .. appid .. ": " .. tostring(apps_err))
        return { ok = false, code = apps_code, error = apps_err }
    end
    return { ok = true, apps = apps }
end

handlers.unlock_app = function(payload)
    local appid = payload.appid
    if not is_numeric_appid(appid) then
        return { ok = false, code = "invalid_appid", error = "a numeric appid is required" }
    end
    return lock.unlock(appid)
end

handlers.list_locked = function()
    local records, err, code = state.list()
    if records == nil then
        error({ message = err or "the lock records are unavailable", code = code }, 0)
    end
    return records
end

handlers.restore_all = function()
    return lock.restore_all()
end

handlers.get_data_root = function()
    return paths.resolve()
end

handlers.get_clock_format = function()
    local is_24h = clock.is_24h()
    if is_24h == nil then
        return { ok = true }
    end
    return { ok = true, is_24h = is_24h }
end

handlers.get_paths = function(payload)
    local appid = payload.appid
    if not is_numeric_appid(appid) then
        return { ok = false, code = "invalid_appid", error = "a numeric appid is required" }
    end
    local record = state.read(appid)
    local manifest
    local lock_path
    if record ~= nil then
        manifest = record.manifest_path
        lock_path = state.path(appid)
    else
        manifest = paths.find_appmanifest(appid)
    end
    return { ok = true, appmanifest = manifest, lock = lock_path }
end

handlers.read_file = function(payload)
    local appid = payload.appid
    if not is_numeric_appid(appid) then
        return { ok = false, code = "invalid_appid", error = "a numeric appid is required" }
    end
    local target = payload.target
    if target ~= "appmanifest" and target ~= "lock" then
        return { ok = false, code = "invalid_target", error = "a valid target is required" }
    end
    local path, path_err, path_code = resolve_target(appid, target)
    if path == nil then
        return { ok = false, code = path_code, error = path_err }
    end
    if type(utils.read_file) ~= "function" then
        return { ok = false, code = "read_failed", error = "the file reader is unavailable" }
    end
    local content, read_err = utils.read_file(path)
    if content == nil then
        return { ok = false, code = "read_failed", error = read_err or "the file could not be read" }
    end
    if #content > MAX_READ then
        return { ok = false, code = "read_failed", error = "the file is too large to display" }
    end
    return { ok = true, content = content }
end

handlers.set_data_root = function(payload)
    local target = payload.path
    if target == nil then
        return { ok = false, code = "data_root_required", error = "a data root path is required" }
    end
    if type(target) ~= "string" then
        return { ok = false, code = "data_root_invalid", error = "the data root path must be a string" }
    end
    local roots = paths.resolve()
    if target == "" then
        local default_root = paths.defaults().data_root
        if type(default_root) ~= "string" or default_root == "" then
            return {
                ok = false,
                code = "default_data_root_unavailable",
                error = "the default data root is unavailable",
            }
        end
        local result
        if normalize(default_root) == normalize(roots.data_root) then
            result = { ok = true, data_root = default_root }
        else
            result = migrate.move(roots.data_root, default_root)
        end
        if not result.ok then
            return result
        end
        clear_data_root_config()
        result.data_root = result.data_root or default_root
        result.is_default = true
        return result
    end
    return migrate.move(roots.data_root, target)
end

handlers.reapply_app = function(payload)
    local appid = payload.appid
    if not is_numeric_appid(appid) then
        return { ok = false, code = "invalid_appid", error = "a numeric appid is required" }
    end
    return lock.reapply(appid)
end

handlers.append_log = function(payload)
    local level = payload.level
    if level ~= "info" and level ~= "warn" and level ~= "error" then
        return { ok = false, error = "a valid log level is required" }
    end
    if type(payload.message) ~= "string" then
        return { ok = false, error = "a log message is required" }
    end
    log.persist("frontend", level, payload.message)
    return { ok = true }
end

---@param name string
---@param payload table
---@return table
local function dispatch(name, payload)
    local handler = handlers[name]
    if type(handler) ~= "function" then
        return { ok = false, code = "unknown_method", error = "unknown method: " .. tostring(name) }
    end
    local ok, result = pcall(handler, payload or {})
    if not ok then
        local code
        if type(result) == "table" and result.message ~= nil then
            code = result.code
            result = result.message
        end
        log.error("method " .. tostring(name) .. " failed: " .. tostring(result))
        return { ok = false, code = code, error = tostring(result) }
    end
    if result == nil then
        return { ok = false, error = "the handler returned no result" }
    end
    return result
end

---@param value any
---@return string
local function encode(value)
    local ok, text = pcall(json.encode, value)
    if not ok then
        return json.encode({ ok = false, error = "failed to encode the result" })
    end
    return text
end

---@param name string
---@param payload any
---@return string
local function respond(name, payload)
    local decoded = {}
    if payload ~= nil and payload ~= "" then
        if type(payload) ~= "string" then
            return encode({ ok = false, error = "the payload must be a JSON string" })
        end
        local ok, value = pcall(json.decode, payload)
        if not ok or type(value) ~= "table" then
            return encode({ ok = false, error = "the payload is not valid JSON" })
        end
        decoded = value
    end
    return encode(dispatch(name, decoded))
end

---@return void
local function on_load()
    millennium.ready()
end

---@return void
local function on_frontend_loaded()
    local records = state.list()
    for _, record in ipairs(records or {}) do
        millennium.call_frontend_method("request_build_info", { record.appid })
    end
end

---@return void
local function on_unload() end

---@ffi
---@param payload string
---@return string
function lock_app(payload)
    return respond("lock_app", payload)
end

---@ffi
---@param payload string
---@return string
function refresh_app(payload)
    return respond("refresh_app", payload)
end

---@ffi
---@param payload string
---@return string
function get_required_apps(payload)
    return respond("get_required_apps", payload)
end

---@ffi
---@param payload string
---@return string
function unlock_app(payload)
    return respond("unlock_app", payload)
end

---@ffi
---@return string
function list_locked()
    return encode(dispatch("list_locked", {}))
end

---@ffi
---@return string
function restore_all()
    return encode(dispatch("restore_all", {}))
end

---@ffi
---@return string
function get_data_root()
    return encode(dispatch("get_data_root", {}))
end

---@ffi
---@return string
function get_clock_format()
    return encode(dispatch("get_clock_format", {}))
end

---@ffi
---@param payload string
---@return string
function set_data_root(payload)
    return respond("set_data_root", payload)
end

---@ffi
---@param payload string
---@return string
function reapply_app(payload)
    return respond("reapply_app", payload)
end

---@ffi
---@param payload string
---@return string
function append_log(payload)
    return respond("append_log", payload)
end

---@ffi
---@param payload string
---@return string
function get_paths(payload)
    return respond("get_paths", payload)
end

---@ffi
---@param payload string
---@return string
function read_file(payload)
    return respond("read_file", payload)
end

return {
    on_load = on_load,
    on_frontend_loaded = on_frontend_loaded,
    on_unload = on_unload,
    dispatch = dispatch,
    handlers = handlers,
}
