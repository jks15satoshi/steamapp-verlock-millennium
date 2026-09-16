local fs = require("fs")
local utils = require("utils")
local acf = require("acf")
local state = require("state")
local paths = require("paths")
local buildinfo = require("buildinfo")

---@class LockResult
---@field ok boolean
---@field error string|nil
---@field code string|nil
---@field record LockedAppRecord|nil

---@class RefreshResult
---@field ok boolean
---@field error string|nil
---@field code string|nil

---@class UnlockResult
---@field ok boolean
---@field error string|nil
---@field code string|nil
---@field auto_update_behavior integer|nil
---@field auto_update_restored boolean|nil

---@class Ack
---@field ok boolean
---@field error string|nil
---@field code string|nil

---@class RestoreResult
---@field ok boolean
---@field error string|nil
---@field code string|nil
---@field restored integer
---@field failed string[]
---@field auto_update table|nil
---@field auto_update_failed string[]|nil

local FULLY_INSTALLED = 4
local BLOCKING_FLAGS = { 2, 8, 1024, 16384, 32768 }

local active = {}
local restoring = false

---@param value integer
---@param bit integer
---@return boolean
local function has_flag(value, bit)
    return math.floor(value / bit) % 2 == 1
end

---@param flags any
---@return boolean
local function lockable(flags)
    local value = tonumber(flags)
    if value == nil then
        return false
    end
    if not has_flag(value, FULLY_INSTALLED) then
        return false
    end
    for _, bit in ipairs(BLOCKING_FLAGS) do
        if has_flag(value, bit) then
            return false
        end
    end
    return true
end

---@param state_table table
---@return table
local function body_of(state_table)
    return state_table.AppState or state_table
end

---@param state_table table
---@param info BuildInfo
---@return void
local function apply_spoof(state_table, info)
    local body = body_of(state_table)
    body.StateFlags = "4"
    body.TargetBuildID = "0"
    body.buildid = tostring(info.buildid)
    local depots = body.InstalledDepots
    if type(depots) ~= "table" then
        depots = {}
        body.InstalledDepots = depots
    end
    for depot_id, manifest_id in pairs(info.depots or {}) do
        local entry = depots[depot_id]
        if type(entry) ~= "table" then
            entry = {}
            depots[depot_id] = entry
        end
        entry.manifest = tostring(manifest_id)
    end
end

-- A depot the record does not list never matches, but apply_spoof only
-- overwrites and never trims, so an appmanifest that persistently carries
-- such a depot is rewritten on every reapply trigger. The repeated rewrite
-- is bounded (one temp-file write per trigger) and deliberate: trimming a
-- depot Steam wrote itself is riskier than rewriting the spoof.
---@param state_table table
---@param info BuildInfo
---@return boolean
local function matches_spoof(state_table, info)
    local body = body_of(state_table)
    if tostring(body.buildid) ~= tostring(info.buildid) then
        return false
    end
    if tostring(body.StateFlags) ~= "4" then
        return false
    end
    if tostring(body.TargetBuildID) ~= "0" then
        return false
    end
    local depots = body.InstalledDepots
    if type(depots) ~= "table" then
        return false
    end
    for depot_id, manifest_id in pairs(info.depots or {}) do
        local entry = depots[depot_id]
        if type(entry) ~= "table" or tostring(entry.manifest) ~= tostring(manifest_id) then
            return false
        end
    end
    for depot_id in pairs(depots) do
        if info.depots == nil or info.depots[depot_id] == nil then
            return false
        end
    end
    return true
end

---@param path string
---@param text string
---@return boolean, string|nil
local function write_original(path, text)
    if type(text) ~= "string" or text == "" then
        return false, "the lock record has no original appmanifest"
    end
    local temporary = path .. "." .. tostring(utils.uuid()) .. ".tmp"
    local written, write_err = utils.write_file(temporary, text)
    if not written then
        fs.remove(temporary)
        return false, write_err or "failed to write the appmanifest"
    end
    local renamed, rename_err = fs.rename(temporary, path)
    if not renamed then
        fs.remove(temporary)
        return false, rename_err or "failed to replace the appmanifest"
    end
    return true
end

---@param appid string
---@param record LockedAppRecord
---@return string|nil, string|nil, string|nil
local function resolve_target(appid, record)
    local manifest, resolve_err = paths.resolve_manifest(appid, record.manifest_path)
    if manifest ~= nil then
        return manifest
    end
    local retry_path, retry_err = paths.find_appmanifest(appid)
    if retry_path ~= nil then
        return retry_path
    end
    if type(record.manifest_path) == "string" and fs.is_file(record.manifest_path) then
        local name = fs.filename(record.manifest_path)
        if name == ("appmanifest_" .. tostring(appid) .. ".acf") then
            local cached_state = acf.read(record.manifest_path)
            if cached_state ~= nil then
                local cached_body = body_of(cached_state)
                if tostring(cached_body.appid) == tostring(appid) then
                    return record.manifest_path
                end
            end
        end
    end
    local error_text = retry_err or resolve_err or "the appmanifest was not found"
    local steam_path = utils.getenv("MILLENNIUM__STEAM_PATH")
    if type(steam_path) ~= "string" or steam_path == "" then
        return nil, nil, retry_err or resolve_err or "the Steam path is unavailable"
    end
    return nil, "not_installed", error_text
end

---@param appid string
---@return boolean
local function begin_app(appid)
    if restoring then
        return false
    end
    if active[appid] then
        return false
    end
    active[appid] = true
    return true
end

---@param appid string
---@return void
local function end_app(appid)
    active[appid] = nil
end

---@param appid string
---@param info BuildInfo
---@param auto_update_behavior integer|nil
---@return LockResult
local function do_lock(appid, info, auto_update_behavior)
    local existing, existing_err = state.read(appid)
    if existing ~= nil then
        return { ok = false, error = "the app is already locked" }
    end
    if existing_err ~= nil then
        return { ok = false, error = existing_err }
    end
    local manifest, find_err = paths.find_appmanifest(appid)
    if manifest == nil then
        return { ok = false, error = find_err }
    end
    local original, read_err = utils.read_file(manifest)
    if original == nil then
        return { ok = false, error = read_err or "cannot read the appmanifest" }
    end
    local state_table = acf.read(manifest)
    if state_table == nil then
        return { ok = false, error = "cannot parse the appmanifest" }
    end
    local body = body_of(state_table)
    if not lockable(body.StateFlags) then
        return { ok = false, error = "the app is not fully installed" }
    end
    local record = {
        version = 1,
        appid = tostring(appid),
        name = tostring(body.name or ("App " .. tostring(appid))),
        manifest_path = manifest,
        locked_at = os.time(),
        locked_build = { buildid = tostring(info.buildid), depots = info.depots },
        original = original,
    }
    if type(auto_update_behavior) == "number" then
        record.auto_update_behavior = auto_update_behavior
    end
    local saved, save_err = state.write(record)
    if not saved then
        return { ok = false, error = save_err or "failed to persist the lock record" }
    end
    apply_spoof(state_table, info)
    local written, write_err = acf.write(manifest, state_table)
    if not written then
        state.remove(appid)
        return { ok = false, error = write_err }
    end
    return { ok = true, record = record }
end

---@param appid string
---@param info BuildInfo
---@param auto_update_behavior integer|nil
---@return LockResult
local function lock(appid, info, auto_update_behavior)
    if not begin_app(appid) then
        return { ok = false, error = "another operation is in progress for this app" }
    end
    local ok, result = pcall(do_lock, appid, info, auto_update_behavior)
    end_app(appid)
    if not ok then
        return { ok = false, error = tostring(result) }
    end
    return result
end

---@param appid string
---@param info BuildInfo
---@return RefreshResult
local function do_refresh(appid, info)
    local record, read_err = state.read(appid)
    if record == nil then
        return { ok = false, error = read_err or "the app is not locked" }
    end
    local manifest, code, resolve_err = resolve_target(appid, record)
    if manifest == nil then
        return { ok = false, error = resolve_err, code = code }
    end
    local state_table = acf.read(manifest)
    if state_table == nil then
        return { ok = false, error = "cannot parse the appmanifest" }
    end
    local previous = {
        locked_build = record.locked_build,
        refreshed_at = record.refreshed_at,
        manifest_path = record.manifest_path,
    }
    record.locked_build = { buildid = tostring(info.buildid), depots = info.depots }
    record.refreshed_at = os.time()
    record.manifest_path = manifest
    local saved, save_err = state.write(record)
    if not saved then
        return { ok = false, error = save_err or "failed to persist the lock record" }
    end
    apply_spoof(state_table, info)
    local written, write_err = acf.write(manifest, state_table)
    if not written then
        record.locked_build = previous.locked_build
        record.refreshed_at = previous.refreshed_at
        record.manifest_path = previous.manifest_path
        state.write(record)
        return { ok = false, error = write_err }
    end
    return { ok = true }
end

---@param appid string
---@param info BuildInfo
---@return RefreshResult
local function refresh(appid, info)
    if not begin_app(appid) then
        return { ok = false, error = "another operation is in progress for this app" }
    end
    local ok, result = pcall(do_refresh, appid, info)
    end_app(appid)
    if not ok then
        return { ok = false, error = tostring(result) }
    end
    return result
end

---@param appid string
---@return UnlockResult
local function do_unlock(appid)
    local record, read_err = state.read(appid)
    if record == nil then
        return { ok = false, error = read_err or "the app is not locked" }
    end
    local manifest, code, resolve_err = resolve_target(appid, record)
    if manifest == nil then
        if code == "not_installed" then
            state.remove(appid)
            return { ok = true, auto_update_behavior = record.auto_update_behavior }
        end
        return { ok = false, error = resolve_err }
    end
    local written, write_err = write_original(manifest, record.original)
    if not written then
        return { ok = false, error = write_err }
    end
    state.remove(appid)
    return { ok = true, auto_update_behavior = record.auto_update_behavior }
end

---@param appid string
---@return UnlockResult
local function unlock(appid)
    if not begin_app(appid) then
        return { ok = false, error = "another operation is in progress for this app" }
    end
    local ok, result = pcall(do_unlock, appid)
    end_app(appid)
    if not ok then
        return { ok = false, error = tostring(result) }
    end
    return result
end

---@param appid string
---@return Ack
local function do_reapply(appid)
    local record, read_err = state.read(appid)
    if record == nil then
        return { ok = false, error = read_err or "the app is not locked" }
    end
    local manifest, code, resolve_err = resolve_target(appid, record)
    if manifest == nil then
        if code == "not_installed" then
            return { ok = false, code = "not_installed", error = resolve_err }
        end
        return { ok = false, error = resolve_err }
    end
    if manifest ~= record.manifest_path then
        record.manifest_path = manifest
        state.write(record)
    end
    local state_table = acf.read(manifest)
    if state_table == nil then
        return { ok = false, error = "cannot parse the appmanifest" }
    end
    if matches_spoof(state_table, record.locked_build) then
        return { ok = true }
    end
    local current = state.read(appid)
    if current == nil then
        return { ok = false, error = "the lock record was removed" }
    end
    apply_spoof(state_table, current.locked_build)
    local written, write_err = acf.write(manifest, state_table)
    if not written then
        return { ok = false, error = write_err }
    end
    return { ok = true }
end

---@param appid string
---@return Ack
local function reapply(appid)
    if restoring then
        return { ok = false, error = "a restore is in progress" }
    end
    if active[appid] then
        return { ok = true }
    end
    active[appid] = true
    local ok, result = pcall(do_reapply, appid)
    active[appid] = nil
    if not ok then
        return { ok = false, error = tostring(result) }
    end
    return result
end

---@return RestoreResult
local function do_restore_all()
    local records, list_err = state.list()
    if records == nil then
        return { ok = false, error = list_err, restored = 0, failed = {} }
    end
    local restored = 0
    local failed = {}
    local auto_update = {}
    for _, record in ipairs(records) do
        local appid = tostring(record.appid)
        local manifest, code = resolve_target(appid, record)
        if manifest == nil then
            if code == "not_installed" then
                state.remove(appid)
            else
                table.insert(failed, appid)
            end
        else
            local written = write_original(manifest, record.original)
            if written then
                state.remove(appid)
                restored = restored + 1
                if type(record.auto_update_behavior) == "number" then
                    table.insert(auto_update, { appid = appid, behavior = record.auto_update_behavior })
                end
            else
                table.insert(failed, appid)
            end
        end
    end
    buildinfo.clear_all()
    return { ok = true, restored = restored, failed = failed, auto_update = auto_update }
end

---@return RestoreResult
local function restore_all()
    if restoring then
        return { ok = false, error = "a restore is already in progress", restored = 0, failed = {} }
    end
    restoring = true
    local ok, result = pcall(do_restore_all)
    restoring = false
    if not ok then
        return { ok = false, error = tostring(result), restored = 0, failed = {} }
    end
    return result
end

return {
    lock = lock,
    refresh = refresh,
    unlock = unlock,
    reapply = reapply,
    restore_all = restore_all,
}
