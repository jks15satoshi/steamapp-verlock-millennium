local fs = require("fs")
local utils = require("utils")
local millennium = require("millennium")
local vdf = require("vdf")
local acf = require("acf")

---@class DataRoots
---@field data_root string
---@field is_default boolean

---@param path string|nil
---@return string|nil
local function normalize(path)
    if type(path) ~= "string" or path == "" then
        return path
    end
    local normalized = path:gsub("\\", "/")
    if normalized == "/" then
        return normalized
    end
    return (normalized:gsub("/+$", ""))
end

---@param path string|nil
---@return boolean
local function is_absolute(path)
    if type(path) ~= "string" or path == "" then
        return false
    end
    if jit and jit.os == "Windows" then
        return path:match("^%a:[/\\]") ~= nil or path:sub(1, 2) == "\\\\"
    end
    return path:sub(1, 1) == "/"
end

---@param inner string|nil
---@param outer string|nil
---@return boolean
local function is_within(inner, outer)
    if type(inner) ~= "string" or type(outer) ~= "string" then
        return false
    end
    local left = normalize(inner)
    local right = normalize(outer)
    if left == nil or right == nil then
        return false
    end
    if left == right then
        return true
    end
    if right == "/" then
        return left:sub(1, 1) == "/"
    end
    return left:sub(1, #right + 1) == right .. "/"
end

---@param base string|nil
---@return string|nil
local function data_default(base)
    if base == nil or base == "" then
        return nil
    end
    return fs.join(base, "steamapp-verlock")
end

---@return DataRoots
local function defaults()
    if jit and jit.os == "Windows" then
        local local_app_data = utils.getenv("LOCALAPPDATA")
        local data_root
        if local_app_data ~= nil and local_app_data ~= "" then
            data_root = fs.join(local_app_data, "steamapp-verlock")
        end
        return {
            data_root = data_root,
            is_default = true,
        }
    end
    local data_home = utils.getenv("XDG_DATA_HOME")
    if data_home == nil or data_home == "" then
        local home = utils.getenv("HOME")
        if home ~= nil and home ~= "" then
            data_home = fs.join(home, ".local", "share")
        end
    end
    return {
        data_root = data_default(data_home),
        is_default = true,
    }
end

---@return string|nil
local function config_base()
    local config_path = utils.getenv("MILLENNIUM__CONFIG_PATH")
    if config_path == nil or config_path == "" then
        local installed = millennium.get_install_path()
        if type(installed) == "string" and installed ~= "" then
            config_path = installed
        end
    end
    return config_path
end

---@return DataRoots
local function resolve()
    local resolved = defaults()
    local configured = millennium.config.get("data_root")
    if type(configured) == "string" and configured ~= "" then
        resolved.data_root = configured
        resolved.is_default = false
    elseif resolved.data_root == nil or resolved.data_root == "" then
        resolved.data_root = data_default(config_base())
        resolved.is_default = false
    end
    return resolved
end

---@param path string
---@return boolean, string|nil, string|nil
local function validate(path)
    if type(path) ~= "string" or path == "" then
        return false, "a data root path is required", "data_root_required"
    end
    if not is_absolute(path) then
        return false, "the data root path must be absolute", "data_root_invalid"
    end
    local current = resolve()
    if is_within(path, current.data_root) or is_within(current.data_root, path) then
        return false, "the data root path must not nest with the current data root", "data_root_invalid"
    end
    local created, create_err = fs.create_directories(path)
    if not created and not fs.is_directory(path) then
        return false, create_err or "the data root path cannot be created", "data_root_invalid"
    end
    local probe = fs.join(path, ".verlock-write-probe")
    local written, write_err = utils.write_file(probe, "")
    if not written then
        return false, write_err or "the data root path is not writable", "data_root_invalid"
    end
    fs.remove(probe)
    return true
end

---@param parsed table|nil
---@return table|nil
local function library_root(parsed)
    if type(parsed) ~= "table" then
        return nil
    end
    if type(parsed.libraryfolders) == "table" then
        return parsed.libraryfolders
    end
    for key, value in pairs(parsed) do
        if type(key) == "string" and key:lower() == "libraryfolders" and type(value) == "table" then
            return value
        end
    end
    return nil
end

---@param appid string
---@return string|nil, string|nil, string|nil
local function find_appmanifest(appid)
    local steam_path = utils.getenv("MILLENNIUM__STEAM_PATH")
    if steam_path == nil or steam_path == "" then
        return nil, "the Steam path is unavailable", "steam_path_unavailable"
    end
    local libraries = {}
    local seen = {}
    local function add(library)
        if type(library) ~= "string" or library == "" then
            return
        end
        local key = normalize(library)
        if key ~= nil and not seen[key] then
            seen[key] = true
            table.insert(libraries, library)
        end
    end
    add(steam_path)
    local sources = {
        fs.join(steam_path, "steamapps", "libraryfolders.vdf"),
        fs.join(steam_path, "config", "libraryfolders.vdf"),
    }
    for _, source in ipairs(sources) do
        local content = utils.read_file(source)
        if content ~= nil then
            local parsed = vdf.parse(content)
            local folders = library_root(parsed)
            if type(folders) == "table" then
                local keys = {}
                for key in pairs(folders) do
                    table.insert(keys, key)
                end
                table.sort(keys, function(left, right)
                    return tostring(left) < tostring(right)
                end)
                for _, key in ipairs(keys) do
                    local folder = folders[key]
                    if type(folder) == "table" and type(folder.path) == "string" then
                        add(folder.path)
                    elseif type(folder) == "string" then
                        add(folder)
                    end
                end
            end
        end
    end
    table.sort(libraries, function(left, right)
        return normalize(left) < normalize(right)
    end)
    for _, library in ipairs(libraries) do
        local candidate = fs.join(library, "steamapps", "appmanifest_" .. tostring(appid) .. ".acf")
        if fs.is_file(candidate) then
            return candidate
        end
    end
    return nil, "no appmanifest found for app " .. tostring(appid), "not_installed"
end

---@param appid string
---@param cached string|nil
---@return string|nil, string|nil, string|nil
local function resolve_manifest(appid, cached)
    if type(cached) == "string" and cached ~= "" then
        local name = fs.filename(cached)
        if name == ("appmanifest_" .. tostring(appid) .. ".acf") and fs.is_file(cached) then
            local state = acf.read(cached)
            if state ~= nil then
                local body = acf.body_of(state)
                if tostring(body.appid) == tostring(appid) then
                    return cached
                end
            end
        end
    end
    return find_appmanifest(appid)
end

return {
    normalize = normalize,
    resolve = resolve,
    defaults = defaults,
    validate = validate,
    find_appmanifest = find_appmanifest,
    resolve_manifest = resolve_manifest,
}
