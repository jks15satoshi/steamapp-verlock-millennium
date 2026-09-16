local json = require("json")
local millennium = require("millennium")
local paths = require("paths")
local state = require("state")
local acf = require("acf")
local buildinfo = require("buildinfo")
local lock = require("lock")
local migrate = require("migrate")
local log = require("log")

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

local handlers = {}

handlers.set_build_info = function(payload)
    local appid = payload.appid
    if not is_numeric_appid(appid) then
        return { ok = false, error = "a numeric appid is required" }
    end
    if type(payload.dump) ~= "string" then
        return { ok = false, error = "a build info dump is required" }
    end
    local stored, store_err = buildinfo.store(appid, payload.dump)
    if not stored then
        log.error("store failed for app " .. appid .. ": " .. tostring(store_err or "failed to store the build info"))
        return { ok = false, error = store_err or "failed to store the build info" }
    end
    return { ok = true }
end

handlers.lock_app = function(payload)
    local appid = payload.appid
    if not is_numeric_appid(appid) then
        return { ok = false, error = "a numeric appid is required" }
    end
    local auto_update_behavior = payload.auto_update_behavior
    if auto_update_behavior ~= nil and type(auto_update_behavior) ~= "number" then
        return { ok = false, error = "the auto update behavior must be a number" }
    end
    local dump, dump_err = buildinfo.load(appid)
    if dump == nil then
        log.error("lock failed for app " .. appid .. ": " .. tostring(dump_err or "no cached build info was found"))
        return { ok = false, error = dump_err or "no cached build info was found" }
    end
    local info, parse_err = buildinfo.parse(buildinfo.clean(dump), resolve_branch(appid))
    if info == nil then
        log.error("lock failed for app " .. appid .. ": " .. tostring(parse_err))
        return { ok = false, error = parse_err }
    end
    local valid, valid_err = buildinfo.validate(info)
    if not valid then
        log.error("lock failed for app " .. appid .. ": " .. tostring(valid_err))
        return { ok = false, error = valid_err }
    end
    return lock.lock(appid, info, auto_update_behavior)
end

handlers.refresh_app = function(payload)
    local appid = payload.appid
    if not is_numeric_appid(appid) then
        return { ok = false, error = "a numeric appid is required" }
    end
    local dump, dump_err = buildinfo.load(appid)
    if dump == nil then
        log.error("refresh failed for app " .. appid .. ": " .. tostring(dump_err or "no cached build info was found"))
        return { ok = false, error = dump_err or "no cached build info was found" }
    end
    local info, parse_err = buildinfo.parse(buildinfo.clean(dump), resolve_branch(appid))
    if info == nil then
        log.error("refresh failed for app " .. appid .. ": " .. tostring(parse_err))
        return { ok = false, error = parse_err }
    end
    local valid, valid_err = buildinfo.validate(info)
    if not valid then
        log.error("refresh failed for app " .. appid .. ": " .. tostring(valid_err))
        return { ok = false, error = valid_err }
    end
    return lock.refresh(appid, info)
end

handlers.unlock_app = function(payload)
    local appid = payload.appid
    if not is_numeric_appid(appid) then
        return { ok = false, error = "a numeric appid is required" }
    end
    return lock.unlock(appid)
end

handlers.list_locked = function()
    local records, err = state.list()
    if records == nil then
        error(err or "the lock records are unavailable", 0)
    end
    return records
end

handlers.restore_all = function()
    return lock.restore_all()
end

handlers.get_data_root = function()
    return paths.resolve()
end

handlers.set_data_root = function(payload)
    local target = payload.path
    if target == nil then
        return { ok = false, error = "a data root path is required" }
    end
    if type(target) ~= "string" then
        return { ok = false, error = "the data root path must be a string" }
    end
    local roots = paths.resolve()
    if target == "" then
        local default_root = paths.defaults().data_root
        if type(default_root) ~= "string" or default_root == "" then
            return { ok = false, error = "the default data root is unavailable" }
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
        return { ok = false, error = "a numeric appid is required" }
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
        return { ok = false, error = "unknown method: " .. tostring(name) }
    end
    local ok, result = pcall(handler, payload or {})
    if not ok then
        log.error("method " .. tostring(name) .. " failed: " .. tostring(result))
        return { ok = false, error = tostring(result) }
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
function set_build_info(payload)
    return respond("set_build_info", payload)
end

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

return {
    on_load = on_load,
    on_frontend_loaded = on_frontend_loaded,
    on_unload = on_unload,
    dispatch = dispatch,
    handlers = handlers,
}
