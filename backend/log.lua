local fs = require("fs")
local utils = require("utils")
local logger = require("logger")

local LOG_FILE_NAME = "steamapp-verlock.log"

local LEVELS = {
    info = true,
    warn = true,
    error = true,
}

local prepared = false

---@return string
local function timestamp()
    return os.date("!%Y-%m-%dT%H:%M:%SZ", utils.time())
end

---@return string|nil
local function directory()
    local dir = utils.getenv("MILLENNIUM__LOGS_PATH")
    if type(dir) ~= "string" or dir == "" then
        return nil
    end
    return dir
end

---@return void
local function ensure_directory()
    if prepared then
        return
    end
    prepared = true
    local dir = directory()
    if dir == nil then
        return
    end
    pcall(fs.create_directories, dir)
end

---@return string|nil
local function path()
    local dir = directory()
    if dir == nil then
        return nil
    end
    return fs.join(dir, LOG_FILE_NAME)
end

---@param source string
---@param level string
---@param message string
---@return void
local function write(source, level, message)
    if not LEVELS[level] then
        return
    end
    ensure_directory()
    local line = timestamp() .. " [" .. source .. "] " .. tostring(message) .. "\n"
    local file = path()
    if file ~= nil then
        pcall(utils.append_file, file, line)
    end
    local sink = logger[level]
    if type(sink) == "function" then
        pcall(sink, logger, line)
    end
end

---@param message string
---@return void
local function write_info(message)
    write("backend", "info", message)
end

---@param message string
---@return void
local function write_warn(message)
    write("backend", "warn", message)
end

---@param message string
---@return void
local function write_error(message)
    write("backend", "error", message)
end

---@param source string
---@param level string
---@param message string
---@return void
local function persist(source, level, message)
    write(source, level, message)
end

return {
    info = write_info,
    warn = write_warn,
    error = write_error,
    persist = persist,
    path = path,
    ensure_directory = ensure_directory,
}
