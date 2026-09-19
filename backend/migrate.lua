local fs = require("fs")
local utils = require("utils")
local json = require("json")
local millennium = require("millennium")
local paths = require("paths")
local state = require("state")
local log = require("log")

local running = false

---@param directory string
---@return boolean, string|nil
local function verify_locks(directory)
    local entries = fs.list(directory)
    for _, entry in ipairs(entries or {}) do
        if entry.is_file and entry.name:sub(-5) == ".lock" then
            local content, read_err = utils.read_file(entry.path)
            if content == nil then
                return false, read_err or ("cannot read " .. entry.name)
            end
            local ok, decoded = pcall(json.decode, content)
            if not ok or type(decoded) ~= "table" then
                return false, "the copied record " .. entry.name .. " is malformed"
            end
            if not state.valid(decoded) then
                return false, "the copied record " .. entry.name .. " is incomplete"
            end
        end
    end
    return true
end

---@param from string
---@param to string
---@return MigrateResult
local function do_move(from, to)
    local valid, valid_err, valid_code = paths.validate(to)
    if not valid then
        log.warn("refused to migrate the data root: " .. tostring(valid_err))
        return { ok = false, code = valid_code, error = valid_err }
    end
    local from_locks = fs.join(from, "locks")
    local to_locks = fs.join(to, "locks")
    local source_exists = fs.is_directory(from_locks)
    if source_exists then
        local copied, copy_err = fs.copy_recursive(from_locks, to_locks)
        if not copied then
            fs.remove_all(to_locks)
            log.error("migrate failed: " .. tostring(copy_err or "failed to copy the lock data"))
            return { ok = false, code = "migration_failed", error = copy_err or "failed to copy the lock data" }
        end
    end
    local verified, verify_err = verify_locks(to_locks)
    if not verified then
        fs.remove_all(to_locks)
        log.error("migrate failed: " .. tostring(verify_err))
        return { ok = false, code = "migration_failed", error = verify_err }
    end
    local persisted, persist_err = millennium.config.set("data_root", to)
    if not persisted then
        fs.remove_all(to_locks)
        log.error("migrate failed: " .. tostring(persist_err or "failed to persist the data root"))
        return { ok = false, code = "migration_failed", error = persist_err or "failed to persist the data root" }
    end
    local result = { ok = true, data_root = to }
    if source_exists then
        local removed, remove_err = fs.remove_all(from_locks)
        if removed == nil then
            result.warning = remove_err or "the old lock directory could not be removed"
        end
    end
    log.info("migrated the data root to " .. tostring(to))
    if result.warning ~= nil then
        log.warn("migrated the data root to " .. tostring(to) .. " but " .. tostring(result.warning))
    end
    return result
end

---@param from string
---@param to string
---@return MigrateResult
local function move(from, to)
    if running then
        return { ok = false, code = "migration_in_progress", error = "a data root migration is already in progress" }
    end
    running = true
    state.set_migrating(true)
    local ok, result = pcall(do_move, from, to)
    state.set_migrating(false)
    running = false
    if not ok then
        log.error("migrate failed: " .. tostring(result))
        return { ok = false, error = tostring(result) }
    end
    return result
end

return {
    move = move,
}
