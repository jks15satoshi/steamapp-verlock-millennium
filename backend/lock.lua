local fs = require("fs")
local utils = require("utils")
local acf = require("acf")
local state = require("state")
local paths = require("paths")
local log = require("log")

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

local active = {}
local restoring = false

---@param flags any
---@return boolean
local function lockable(flags)
    local value = tonumber(flags)
    if value == nil then
        return false
    end
    return value == 4 or value == 6
end

---@param state_table table
---@return table
local function body_of(state_table)
    return state_table.AppState or state_table
end

-- The record describes the installed depots only. The captured `BuildInfo` can
-- carry depots the appmanifest does not list — the base PICS lists other
-- platforms, and a DLC app's PICS lists its other language depots — so the
-- record keeps the intersection with `InstalledDepots`.
---@param state_table table
---@param info BuildInfo
---@return table<string, string>
local function installed_depots(state_table, info)
    local body = body_of(state_table)
    local depots = body.InstalledDepots
    local result = {}
    if type(depots) ~= "table" then
        return result
    end
    for depot_id in pairs(depots) do
        local manifest_id = (info.depots or {})[depot_id]
        if manifest_id ~= nil then
            result[depot_id] = tostring(manifest_id)
        end
    end
    return result
end

---@param left table|nil
---@param right table|nil
---@return boolean
local function same_depots(left, right)
    for key, value in pairs(left or {}) do
        if (right or {})[key] ~= value then
            return false
        end
    end
    for key in pairs(right or {}) do
        if (left or {})[key] == nil then
            return false
        end
    end
    return true
end

---@param state_table table
---@param info BuildInfo
---@return void
local function apply_spoof(state_table, info)
    local body = body_of(state_table)
    body.StateFlags = "4"
    body.TargetBuildID = "0"
    body.buildid = tostring(info.buildid)
    body.UpdateResult = "0"
    body.StagingSize = "0"
    body.ScheduledAutoUpdate = "0"
    body.DownloadType = "3"
    if body.BytesToDownload ~= nil then
        body.BytesDownloaded = tostring(body.BytesToDownload)
    end
    if body.BytesToStage ~= nil then
        body.BytesStaged = tostring(body.BytesToStage)
    end
    local depots = body.InstalledDepots
    if type(depots) ~= "table" then
        return
    end
    for depot_id, manifest_id in pairs(info.depots or {}) do
        local entry = depots[depot_id]
        if type(entry) == "table" then
            entry.manifest = tostring(manifest_id)
        end
    end
end

-- A recorded depot the appmanifest does not install is ignored, because the
-- record holds only the installed depots and apply_spoof only overwrites them:
-- a PICS-only depot must not be injected into InstalledDepots. A recorded depot
-- that is installed but missing or carrying a different manifest still forces
-- the rewrite.
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
    local target = body.TargetBuildID
    if target ~= nil and tostring(target) ~= "0" and tostring(target) ~= tostring(info.buildid) then
        return false
    end
    if body.UpdateResult ~= nil and tostring(body.UpdateResult) ~= "0" then
        return false
    end
    if body.StagingSize ~= nil and tostring(body.StagingSize) ~= "0" then
        return false
    end
    if body.ScheduledAutoUpdate ~= nil and tostring(body.ScheduledAutoUpdate) ~= "0" then
        return false
    end
    if body.DownloadType ~= nil and tostring(body.DownloadType) ~= "3" then
        return false
    end
    if body.BytesToDownload ~= nil and tostring(body.BytesDownloaded) ~= tostring(body.BytesToDownload) then
        return false
    end
    if body.BytesToStage ~= nil and tostring(body.BytesStaged) ~= tostring(body.BytesToStage) then
        return false
    end
    local depots = body.InstalledDepots
    if type(depots) ~= "table" then
        return false
    end
    for depot_id, manifest_id in pairs(info.depots or {}) do
        local entry = depots[depot_id]
        if type(entry) == "table" and tostring(entry.manifest) ~= tostring(manifest_id) then
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
    -- resolve_manifest already validates the cached path and falls back to
    -- discovery, so a single call covers both.
    local manifest, resolve_err, resolve_code = paths.resolve_manifest(appid, record.manifest_path)
    if manifest ~= nil then
        return manifest
    end
    local steam_path = utils.getenv("MILLENNIUM__STEAM_PATH")
    if type(steam_path) ~= "string" or steam_path == "" then
        return nil, "steam_path_unavailable", resolve_err or "the Steam path is unavailable"
    end
    return nil, resolve_code or "not_installed", resolve_err or "the appmanifest was not found"
end

-- The DLC apps whose installed depots the base app's PICS does not cover, so
-- their manifests must be read from the owning app's own app_info_print.
---@param appid string
---@param info BuildInfo
---@return string[]|nil, string|nil, string|nil
local function required_apps(appid, info)
    local record = state.read(appid)
    local manifest
    local manifest_code
    if record ~= nil then
        manifest, manifest_code = resolve_target(appid, record)
    else
        local found, _, find_code = paths.find_appmanifest(appid)
        manifest = found
        manifest_code = find_code
    end
    if manifest == nil then
        return nil, "the appmanifest was not found", manifest_code or "not_installed"
    end
    local state_table = acf.read(manifest)
    if state_table == nil then
        return nil, "cannot parse the appmanifest", "cannot_parse_manifest"
    end
    local body = body_of(state_table)
    local depots = body.InstalledDepots
    if type(depots) ~= "table" then
        return {}
    end
    local apps = {}
    local seen = {}
    for depot_id, entry in pairs(depots) do
        if type(entry) == "table" and type(entry.dlcappid) == "string" then
            if info.depots == nil or info.depots[depot_id] == nil then
                if not seen[entry.dlcappid] then
                    seen[entry.dlcappid] = true
                    table.insert(apps, entry.dlcappid)
                end
            end
        end
    end
    table.sort(apps)
    return apps
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
    local existing, existing_err, existing_code = state.read(appid)
    if existing ~= nil then
        log.warn("refused to lock app " .. appid .. ": the app is already locked")
        return { ok = false, code = "already_locked", error = "the app is already locked" }
    end
    if existing_err ~= nil then
        log.error("lock failed for app " .. appid .. ": " .. tostring(existing_err))
        return { ok = false, code = existing_code, error = existing_err }
    end
    local manifest, find_err, find_code = paths.find_appmanifest(appid)
    if manifest == nil then
        log.warn("refused to lock app " .. appid .. ": " .. tostring(find_err))
        return { ok = false, code = find_code or "not_installed", error = find_err }
    end
    local original, read_err = utils.read_file(manifest)
    if original == nil then
        log.error("lock failed for app " .. appid .. ": " .. tostring(read_err or "cannot read the appmanifest"))
        return { ok = false, code = "cannot_read_manifest", error = read_err or "cannot read the appmanifest" }
    end
    local state_table = acf.read(manifest)
    if state_table == nil then
        log.error("lock failed for app " .. appid .. ": cannot parse the appmanifest")
        return { ok = false, code = "cannot_parse_manifest", error = "cannot parse the appmanifest" }
    end
    local body = body_of(state_table)
    if not lockable(body.StateFlags) then
        log.warn("refused to lock app " .. appid .. ": the app is not fully installed")
        return { ok = false, code = "not_fully_installed", error = "the app is not fully installed" }
    end
    local record = {
        version = 1,
        appid = tostring(appid),
        name = tostring(body.name or ("App " .. tostring(appid))),
        manifest_path = manifest,
        locked_at = os.time(),
        locked_build = { buildid = tostring(info.buildid), depots = installed_depots(state_table, info) },
        original = original,
    }
    if type(auto_update_behavior) == "number" then
        record.auto_update_behavior = auto_update_behavior
    end
    local saved, save_err = state.write(record)
    if not saved then
        log.error("lock failed for app " .. appid .. ": " .. tostring(save_err or "failed to persist the lock record"))
        return { ok = false, code = "record_persist_failed", error = save_err or "failed to persist the lock record" }
    end
    apply_spoof(state_table, info)
    local written, write_err = acf.write(manifest, state_table)
    if not written then
        state.remove(appid)
        log.error("lock failed for app " .. appid .. ": " .. tostring(write_err))
        return { ok = false, code = "manifest_write_failed", error = write_err }
    end
    log.info("locked app " .. appid .. " at build " .. tostring(info.buildid))
    return { ok = true, record = record }
end

---@param appid string
---@param info BuildInfo
---@param auto_update_behavior integer|nil
---@return LockResult
local function lock(appid, info, auto_update_behavior)
    if not begin_app(appid) then
        return { ok = false, code = "operation_in_progress", error = "another operation is in progress for this app" }
    end
    local ok, result = pcall(do_lock, appid, info, auto_update_behavior)
    end_app(appid)
    if not ok then
        log.error("lock failed for app " .. appid .. ": " .. tostring(result))
        return { ok = false, error = tostring(result) }
    end
    return result
end

---@param appid string
---@param info BuildInfo
---@return RefreshResult
local function do_refresh(appid, info)
    local record, read_err, read_code = state.read(appid)
    if record == nil then
        log.warn("refused to refresh app " .. appid .. ": " .. tostring(read_err or "the app is not locked"))
        return { ok = false, code = read_code or "not_locked", error = read_err or "the app is not locked" }
    end
    local manifest, code, resolve_err = resolve_target(appid, record)
    if manifest == nil then
        if code == "not_installed" then
            log.warn("app " .. appid .. " is no longer installed")
        else
            log.error("refresh failed for app " .. appid .. ": " .. tostring(resolve_err))
        end
        return { ok = false, error = resolve_err, code = code }
    end
    local state_table = acf.read(manifest)
    if state_table == nil then
        log.error("refresh failed for app " .. appid .. ": cannot parse the appmanifest")
        return { ok = false, code = "cannot_parse_manifest", error = "cannot parse the appmanifest" }
    end
    local previous = {
        locked_build = record.locked_build,
        refreshed_at = record.refreshed_at,
        manifest_path = record.manifest_path,
    }
    record.locked_build = { buildid = tostring(info.buildid), depots = installed_depots(state_table, info) }
    record.refreshed_at = os.time()
    record.manifest_path = manifest
    local saved, save_err = state.write(record)
    if not saved then
        log.error(
            "refresh failed for app " .. appid .. ": " .. tostring(save_err or "failed to persist the lock record")
        )
        return { ok = false, code = "record_persist_failed", error = save_err or "failed to persist the lock record" }
    end
    apply_spoof(state_table, info)
    local written, write_err = acf.write(manifest, state_table)
    if not written then
        record.locked_build = previous.locked_build
        record.refreshed_at = previous.refreshed_at
        record.manifest_path = previous.manifest_path
        state.write(record)
        log.error("refresh failed for app " .. appid .. ": " .. tostring(write_err))
        return { ok = false, code = "manifest_write_failed", error = write_err }
    end
    log.info("refreshed app " .. appid .. " to build " .. tostring(info.buildid))
    return { ok = true }
end

---@param appid string
---@param info BuildInfo
---@return RefreshResult
local function refresh(appid, info)
    if not begin_app(appid) then
        return { ok = false, code = "operation_in_progress", error = "another operation is in progress for this app" }
    end
    local ok, result = pcall(do_refresh, appid, info)
    end_app(appid)
    if not ok then
        log.error("refresh failed for app " .. appid .. ": " .. tostring(result))
        return { ok = false, error = tostring(result) }
    end
    return result
end

---@param appid string
---@return UnlockResult
local function do_unlock(appid)
    local record, read_err, read_code = state.read(appid)
    if record == nil then
        log.warn("refused to unlock app " .. appid .. ": " .. tostring(read_err or "the app is not locked"))
        return { ok = false, code = read_code or "not_locked", error = read_err or "the app is not locked" }
    end
    local manifest, code, resolve_err = resolve_target(appid, record)
    if manifest == nil then
        if code == "not_installed" then
            state.remove(appid)
            log.warn("app " .. appid .. " is no longer installed")
            return { ok = true, auto_update_behavior = record.auto_update_behavior }
        end
        log.error("unlock failed for app " .. appid .. ": " .. tostring(resolve_err))
        return { ok = false, code = code, error = resolve_err }
    end
    local written, write_err = write_original(manifest, record.original)
    if not written then
        log.error("unlock failed for app " .. appid .. ": " .. tostring(write_err))
        return { ok = false, code = "manifest_write_failed", error = write_err }
    end
    state.remove(appid)
    log.info("unlocked app " .. appid)
    return { ok = true, auto_update_behavior = record.auto_update_behavior }
end

---@param appid string
---@return UnlockResult
local function unlock(appid)
    if not begin_app(appid) then
        return { ok = false, code = "operation_in_progress", error = "another operation is in progress for this app" }
    end
    local ok, result = pcall(do_unlock, appid)
    end_app(appid)
    if not ok then
        log.error("unlock failed for app " .. appid .. ": " .. tostring(result))
        return { ok = false, error = tostring(result) }
    end
    return result
end

---@param appid string
---@return Ack
local function do_reapply(appid)
    local record, read_err, read_code = state.read(appid)
    if record == nil then
        log.warn("refused to reapply app " .. appid .. ": " .. tostring(read_err or "the app is not locked"))
        return { ok = false, code = read_code or "not_locked", error = read_err or "the app is not locked" }
    end
    local manifest, code, resolve_err = resolve_target(appid, record)
    if manifest == nil then
        if code == "not_installed" then
            log.warn("app " .. appid .. " is no longer installed")
            return { ok = false, code = "not_installed", error = resolve_err }
        end
        log.error("reapply failed for app " .. appid .. ": " .. tostring(resolve_err))
        return { ok = false, code = code, error = resolve_err }
    end
    if manifest ~= record.manifest_path then
        record.manifest_path = manifest
        state.write(record)
    end
    local state_table = acf.read(manifest)
    if state_table == nil then
        log.error("reapply failed for app " .. appid .. ": cannot parse the appmanifest")
        return { ok = false, code = "cannot_parse_manifest", error = "cannot parse the appmanifest" }
    end
    local normalized = installed_depots(state_table, record.locked_build)
    if not same_depots(record.locked_build.depots, normalized) then
        record.locked_build = { buildid = record.locked_build.buildid, depots = normalized }
        state.write(record)
    end
    if matches_spoof(state_table, record.locked_build) then
        return { ok = true }
    end
    local current = state.read(appid)
    if current == nil then
        log.warn("refused to reapply app " .. appid .. ": the lock record was removed")
        return { ok = false, code = "record_removed", error = "the lock record was removed" }
    end
    apply_spoof(state_table, current.locked_build)
    local written, write_err = acf.write(manifest, state_table)
    if not written then
        log.error("reapply failed for app " .. appid .. ": " .. tostring(write_err))
        return { ok = false, code = "manifest_write_failed", error = write_err }
    end
    log.info("reapplied app " .. appid)
    return { ok = true }
end

---@param appid string
---@return Ack
local function reapply(appid)
    if restoring then
        return { ok = false, code = "restore_in_progress", error = "a restore is in progress" }
    end
    if active[appid] then
        return { ok = true }
    end
    active[appid] = true
    local ok, result = pcall(do_reapply, appid)
    active[appid] = nil
    if not ok then
        log.error("reapply failed for app " .. appid .. ": " .. tostring(result))
        return { ok = false, error = tostring(result) }
    end
    return result
end

---@return RestoreResult
local function do_restore_all()
    local records, list_err, list_code = state.list()
    if records == nil then
        log.error("restore all failed: " .. tostring(list_err))
        return { ok = false, code = list_code, error = list_err, restored = 0, failed = {} }
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
                log.info("dropped the lock record for app " .. appid .. ": it is no longer installed")
            else
                log.warn("restore all kept app " .. appid .. ": the appmanifest could not be resolved")
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
                log.warn("restore all kept app " .. appid .. ": the appmanifest could not be restored")
                table.insert(failed, appid)
            end
        end
    end
    log.info("restored " .. tostring(restored) .. " app(s), kept " .. tostring(#failed))
    return { ok = true, restored = restored, failed = failed, auto_update = auto_update }
end

---@return RestoreResult
local function restore_all()
    if restoring then
        return {
            ok = false,
            code = "restore_in_progress",
            error = "a restore is already in progress",
            restored = 0,
            failed = {},
        }
    end
    if next(active) ~= nil then
        return {
            ok = false,
            code = "operation_in_progress",
            error = "another operation is in progress",
            restored = 0,
            failed = {},
        }
    end
    restoring = true
    local ok, result = pcall(do_restore_all)
    restoring = false
    if not ok then
        log.error("restore all failed: " .. tostring(result))
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
    required_apps = required_apps,
}
