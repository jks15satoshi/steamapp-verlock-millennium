local fs = require("fs")
local utils = require("utils")
local json = require("json")
local paths = require("paths")

---@class LockedAppRecord
---@field version integer
---@field appid string
---@field name string
---@field manifest_path string
---@field locked_at integer
---@field refreshed_at integer|nil
---@field auto_update_behavior integer|nil
---@field locked_build BuildInfo
---@field original string

local migrating = false

---@param flag boolean
---@return void
local function set_migrating(flag)
    migrating = flag
end

---@param decoded table|nil
---@return boolean
local function has_required_fields(decoded)
    if type(decoded) ~= "table" then
        return false
    end
    if
        decoded.appid == nil
        or decoded.name == nil
        or decoded.manifest_path == nil
        or decoded.locked_at == nil
        or decoded.locked_build == nil
    then
        return false
    end
    if type(decoded.original) ~= "string" or decoded.original == "" then
        return false
    end
    if decoded.auto_update_behavior ~= nil and type(decoded.auto_update_behavior) ~= "number" then
        return false
    end
    return true
end

---@param decoded table|nil
---@return boolean
local function valid(decoded)
    if type(decoded) ~= "table" or decoded.version ~= 1 then
        return false
    end
    return has_required_fields(decoded)
end

---@return string
local function locks_directory()
    local roots = paths.resolve()
    return fs.join(roots.data_root, "locks")
end

---@param appid string
---@return string
local function path(appid)
    return fs.join(locks_directory(), tostring(appid) .. ".lock")
end

---@return LockedAppRecord[]|nil, string|nil
local function list()
    if migrating then
        return nil, "a data root migration is in progress"
    end
    local entries = fs.list(locks_directory())
    local records = {}
    for _, entry in ipairs(entries or {}) do
        if entry.is_file and entry.name:sub(-5) == ".lock" then
            local content = utils.read_file(entry.path)
            if content ~= nil then
                local ok, decoded = pcall(json.decode, content)
                if ok and valid(decoded) then
                    table.insert(records, decoded)
                end
            end
        end
    end
    return records, nil
end

---@param appid string
---@return LockedAppRecord|nil, string|nil
local function read(appid)
    if migrating then
        return nil, "a data root migration is in progress"
    end
    local content = utils.read_file(path(appid))
    if content == nil then
        return nil
    end
    local ok, decoded = pcall(json.decode, content)
    if not ok or type(decoded) ~= "table" then
        return nil, "the lock record is malformed"
    end
    if decoded.version ~= 1 then
        return nil, "the lock record has an unsupported version"
    end
    if not has_required_fields(decoded) then
        return nil, "the lock record is incomplete"
    end
    return decoded
end

---@param record LockedAppRecord
---@return boolean, string|nil
local function write(record)
    if migrating then
        return false, "a data root migration is in progress"
    end
    if type(record) ~= "table" or record.appid == nil then
        return false, "a lock record with an appid is required"
    end
    local target = path(record.appid)
    local temporary = target .. "." .. tostring(utils.uuid()) .. ".tmp"
    local encoded = json.encode(record)
    local written, write_err = utils.write_file(temporary, encoded)
    if not written then
        fs.remove(temporary)
        return false, write_err or "failed to write the lock record"
    end
    local renamed, rename_err = fs.rename(temporary, target)
    if not renamed then
        fs.remove(temporary)
        return false, rename_err or "failed to replace the lock record"
    end
    return true
end

---@param appid string
---@return void
local function remove(appid)
    if migrating then
        return
    end
    fs.remove(path(appid))
end

return {
    list = list,
    read = read,
    write = write,
    remove = remove,
    path = path,
    set_migrating = set_migrating,
    valid = valid,
}
