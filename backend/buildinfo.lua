local vdf = require("vdf")
local fs = require("fs")
local utils = require("utils")
local paths = require("paths")

---@class BuildInfo
---@field buildid string
---@field depots table<string, string>

local NOISE_PATTERNS = {
    "^%s*%]",
    "^%s*AppID%s*:",
}

---@param line string
---@param state boolean
---@return boolean
local function advance_string_state(line, state)
    local position = 1
    while position <= #line do
        local char = line:sub(position, position)
        if char == "\\" then
            position = position + 2
        elseif char == '"' then
            state = not state
            position = position + 1
        else
            position = position + 1
        end
    end
    return state
end

---@param raw string
---@return string
local function clean(raw)
    if type(raw) ~= "string" then
        return ""
    end
    local lines = {}
    local in_string = false
    for line in (raw .. "\n"):gmatch("(.-)\n") do
        local trimmed = line:gsub("\r$", "")
        local drop = false
        if not in_string then
            local stripped = trimmed:match("^%s*(.*)$") or trimmed
            local first = stripped:sub(1, 1)
            if stripped ~= "" and first ~= '"' and first ~= "{" and first ~= "}" then
                drop = true
            end
            if not drop then
                for _, pattern in ipairs(NOISE_PATTERNS) do
                    if trimmed:match(pattern) then
                        drop = true
                        break
                    end
                end
            end
            if not drop and trimmed:find("Connectivity state changed", 1, true) then
                drop = true
            end
        end
        if not drop then
            table.insert(lines, trimmed)
            in_string = advance_string_state(trimmed, in_string)
        end
    end
    return table.concat(lines, "\n")
end

---@param tbl table
---@return table|nil
local function find_app(tbl)
    if type(tbl) ~= "table" then
        return nil
    end
    if type(tbl.depots) == "table" then
        return tbl
    end
    for _, value in pairs(tbl) do
        if type(value) == "table" and type(value.depots) == "table" then
            return value
        end
    end
    return nil
end

---@param entry any
---@return string|nil
local function extract_manifest(entry)
    if type(entry) == "string" then
        return entry
    end
    if type(entry) == "table" then
        if type(entry.gid) == "string" then
            return entry.gid
        end
        if type(entry.manifest) == "string" then
            return entry.manifest
        end
    end
    return nil
end

---@param app table
---@param branch string
---@return string|nil
local function resolve_buildid(app, branch)
    local depots = app.depots
    local branches = depots and depots.branches
    if type(branches) == "table" then
        local selected = branches[branch]
        if type(selected) == "table" and type(selected.buildid) == "string" and selected.buildid ~= "" then
            return selected.buildid
        end
    end
    if type(app.buildid) == "string" and app.buildid ~= "" then
        return app.buildid
    end
    if type(branches) == "table" then
        local public = branches.public
        if type(public) == "table" and type(public.buildid) == "string" and public.buildid ~= "" then
            return public.buildid
        end
    end
    return nil
end

---@param text string
---@param branch string|nil
---@return BuildInfo|nil, string|nil
local function parse(text, branch)
    branch = branch or "public"
    local root, err = vdf.parse(text)
    if root == nil then
        return nil, err or "malformed build info dump"
    end
    local app = find_app(root)
    if app == nil then
        return nil, "no app info in dump"
    end
    local depots = app.depots
    if type(depots) ~= "table" then
        return nil, "no depots in dump"
    end
    local buildid = resolve_buildid(app, branch)
    if buildid == nil or buildid == "" then
        return nil, "no buildid in dump"
    end
    local manifests = {}
    for depot_id, depot in pairs(depots) do
        if type(depot_id) == "string" and depot_id:match("^%d+$") and type(depot) == "table" then
            local candidates = depot.manifests
            if type(candidates) == "table" then
                local entry = candidates[branch]
                if entry == nil then
                    entry = candidates.public
                end
                local manifest_id = extract_manifest(entry)
                if manifest_id ~= nil and manifest_id ~= "" then
                    manifests[depot_id] = tostring(manifest_id)
                end
            end
        end
    end
    if next(manifests) == nil then
        return nil, "no depot manifests in dump"
    end
    return { buildid = tostring(buildid), depots = manifests }
end

---@param info BuildInfo
---@return boolean, string|nil
local function validate(info)
    if type(info) ~= "table" then
        return false, "build info must be a table"
    end
    if type(info.buildid) ~= "string" or info.buildid == "" then
        return false, "build info is missing a buildid"
    end
    if type(info.depots) ~= "table" then
        return false, "build info is missing depots"
    end
    local count = 0
    for _, manifest_id in pairs(info.depots) do
        if type(manifest_id) ~= "string" or manifest_id == "" then
            return false, "build info has an invalid depot manifest"
        end
        count = count + 1
    end
    if count == 0 then
        return false, "build info has no depot manifests"
    end
    return true
end

---@return string|nil, string|nil
local function store_path()
    local cache_root = paths.resolve().cache_root
    if type(cache_root) ~= "string" or cache_root == "" then
        return nil, "the cache root is unavailable"
    end
    return cache_root
end

---@param appid string
---@param dump string
---@return boolean, string|nil
local function store(appid, dump)
    if type(appid) ~= "string" or appid == "" then
        return false, "an appid is required"
    end
    if type(dump) ~= "string" then
        return false, "a build info dump is required"
    end
    local cache_root, cache_err = store_path()
    if cache_root == nil then
        return false, cache_err
    end
    local directory = fs.join(cache_root, "buildinfo")
    local created, create_err = fs.create_directories(directory)
    if not created and not fs.is_directory(directory) then
        return false, create_err or "the buildinfo directory cannot be created"
    end
    return utils.write_file(fs.join(directory, tostring(appid) .. ".kv"), dump)
end

---@param appid string
---@return string|nil, string|nil
local function load(appid)
    if type(appid) ~= "string" or appid == "" then
        return nil, "an appid is required"
    end
    local cache_root, cache_err = store_path()
    if cache_root == nil then
        return nil, cache_err
    end
    return utils.read_file(fs.join(cache_root, "buildinfo", tostring(appid) .. ".kv"))
end

---@return void
local function clear_all()
    local cache_root = store_path()
    if cache_root == nil then
        return
    end
    local directory = fs.join(cache_root, "buildinfo")
    if not fs.is_directory(directory) then
        return
    end
    local entries = fs.list(directory)
    for _, entry in ipairs(entries or {}) do
        fs.remove_all(entry.path)
    end
end

return {
    clean = clean,
    parse = parse,
    validate = validate,
    store = store,
    load = load,
    clear_all = clear_all,
}
