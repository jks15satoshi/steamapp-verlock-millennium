local vdf = require("vdf")

---@class BuildInfo
---@field buildid string
---@field depots table<string, string>

---@param text string
---@param start integer
---@return string|nil
local function extract_block(text, start)
    local depth = 0
    local index = start
    local in_string = false
    local length = #text
    while index <= length do
        local char = text:sub(index, index)
        if in_string then
            if char == "\\" then
                index = index + 2
            else
                if char == '"' then
                    in_string = false
                end
                index = index + 1
            end
        elseif char == '"' then
            in_string = true
            index = index + 1
        elseif char == "{" then
            depth = depth + 1
            index = index + 1
        elseif char == "}" then
            depth = depth - 1
            if depth == 0 then
                return text:sub(start, index)
            end
            index = index + 1
        else
            index = index + 1
        end
    end
    return nil
end

---@param text string
---@return string
local function strip_prefixes(text)
    local lines = {}
    for line in (text .. "\n"):gmatch("(.-)\n") do
        local trimmed = line:gsub("\r$", "")
        local start = trimmed:find('["{}]')
        if start ~= nil then
            table.insert(lines, trimmed:sub(start))
        end
    end
    return table.concat(lines, "\n")
end

---@param raw string
---@return string
local function clean(raw)
    if type(raw) ~= "string" then
        return ""
    end
    local text = raw:gsub("\27%[[%d;]*m", "")
    text = strip_prefixes(text)
    local start = text:find('"(%d+)"%s*{')
    if start ~= nil then
        local block = extract_block(text, start)
        if block ~= nil then
            return block
        end
    end
    return ""
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

return {
    clean = clean,
    parse = parse,
    validate = validate,
}
