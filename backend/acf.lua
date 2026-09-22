local fs = require("fs")
local utils = require("utils")
local vdf = require("vdf")

---@param path string
---@return table|nil, string|nil, string|nil
local function read(path)
    local content, err = utils.read_file(path)
    if content == nil then
        return nil, err or ("cannot read appmanifest: " .. tostring(path)), "cannot_read_manifest"
    end
    local parsed, parse_err = vdf.parse(content)
    if parsed == nil then
        return nil, parse_err, "cannot_parse_manifest"
    end
    return parsed
end

---@param state_table table
---@return table
local function body_of(state_table)
    return state_table.AppState or state_table
end

---@param path string
---@param text string
---@param opts table|nil
---@return boolean, string|nil
local function atomic_write(path, text, opts)
    opts = opts or {}
    local temporary = path .. "." .. tostring(utils.uuid()) .. ".tmp"
    local written, write_err = utils.write_file(temporary, text)
    if not written then
        fs.remove(temporary)
        return false, write_err or opts.write_error
    end
    local renamed, rename_err = fs.rename(temporary, path)
    if not renamed then
        fs.remove(temporary)
        return false, rename_err or opts.replace_error
    end
    return true
end

---@param state table
---@param key string
---@param value string
---@return void
local function set(state, key, value)
    if type(state) ~= "table" then
        return
    end
    local body = state.AppState
    if type(body) ~= "table" then
        body = state
    end
    body[key] = value
end

---@param path string
---@param state table
---@return boolean, string|nil, string|nil
local function write(path, state)
    local text = vdf.serialize(state)
    local written, write_err = atomic_write(path, text, {
        write_error = "failed to write appmanifest",
        replace_error = "failed to replace appmanifest",
    })
    if not written then
        return false, write_err, "manifest_write_failed"
    end
    return true
end

return {
    read = read,
    body_of = body_of,
    atomic_write = atomic_write,
    set = set,
    write = write,
}
