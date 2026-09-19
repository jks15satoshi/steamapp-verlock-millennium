local fs = require("fs")
local utils = require("utils")
local vdf = require("vdf")
local json = require("json")

local SETTING_KEY = "b24HourClock"

---@param value any
---@return boolean|nil
local function to_boolean(value)
    if value == true or value == 1 or value == "1" or value == "true" then
        return true
    end
    if value == false or value == 0 or value == "0" or value == "false" then
        return false
    end
    return nil
end

---@param record table|nil
---@return boolean|nil
local function from_record(record)
    if type(record) ~= "table" then
        return nil
    end
    local software = record.Software
    local valve = type(software) == "table" and software.Valve or nil
    local steam = type(valve) == "table" and valve.Steam or nil
    local friends = type(steam) == "table" and steam.FriendsUI or nil
    local payload = type(friends) == "table" and friends.FriendsUIJSON or nil
    if type(payload) ~= "string" then
        return nil
    end
    local ok, decoded = pcall(json.decode, payload)
    if not ok or type(decoded) ~= "table" then
        return nil
    end
    return to_boolean(decoded[SETTING_KEY])
end

---@param path string
---@return boolean|nil
local function from_file(path)
    if not fs.is_file(path) then
        return nil
    end
    local text = utils.read_file(path)
    if type(text) ~= "string" or text == "" then
        return nil
    end
    local ok, parsed = pcall(vdf.parse, text)
    if not ok or type(parsed) ~= "table" then
        return nil
    end
    for _, key in ipairs({ "UserRoamingConfigStore", "UserLocalConfigStore" }) do
        local value = from_record(parsed[key])
        if value ~= nil then
            return value
        end
    end
    return nil
end

---@return boolean|nil
local function is_24h()
    local steam_path = utils.getenv("MILLENNIUM__STEAM_PATH")
    if steam_path == nil or steam_path == "" then
        return nil
    end
    local userdata = fs.join(steam_path, "userdata")
    if not fs.is_directory(userdata) then
        return nil
    end
    local entries = fs.list(userdata)
    for _, entry in ipairs(entries or {}) do
        if entry.is_directory and type(entry.path) == "string" then
            local shared = from_file(fs.join(entry.path, "7", "remote", "sharedconfig.vdf"))
            if shared ~= nil then
                return shared
            end
            local local_config = from_file(fs.join(entry.path, "config", "localconfig.vdf"))
            if local_config ~= nil then
                return local_config
            end
        end
    end
    return nil
end

return {
    is_24h = is_24h,
}
