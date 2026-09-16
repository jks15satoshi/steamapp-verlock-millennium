local META = {}

---@class VdfState
---@field [string] VdfState|string

---@param value any
---@return string
local function quote(value)
    local text = tostring(value)
    text = text:gsub("\\", "\\\\")
    text = text:gsub('"', '\\"')
    return '"' .. text .. '"'
end

---@param tbl table
---@return string[]
local function ordered_keys(tbl)
    local keys = {}
    for key in pairs(tbl) do
        table.insert(keys, key)
    end
    table.sort(keys, function(left, right)
        return tostring(left) < tostring(right)
    end)
    return keys
end

---@param tbl table
---@param depth integer
---@return string
local function canonical_object(tbl, depth)
    local indent = string.rep("\t", depth)
    local parts = {}
    for _, key in ipairs(ordered_keys(tbl)) do
        local value = tbl[key]
        if type(value) == "table" then
            local inner = canonical_object(value, depth + 1)
            local block = indent .. quote(key) .. "\n" .. indent .. "{"
            if inner ~= "" then
                block = block .. "\n" .. inner .. "\n" .. indent
            end
            block = block .. "}"
            table.insert(parts, block)
        else
            table.insert(parts, indent .. quote(key) .. "\t\t" .. quote(value))
        end
    end
    return table.concat(parts, "\n")
end

---@param object table
---@param meta table
---@param depth integer
---@return string
local function serialize_scanned(object, meta, depth)
    local parts = {}
    local seen = {}
    for _, entry in ipairs(meta.entries) do
        local segment = nil
        if entry.kind == "object" then
            local child = object[entry.key]
            if type(child) == "table" then
                local child_meta = META[child]
                local inner
                if child_meta then
                    inner = serialize_scanned(child, child_meta, depth + 1)
                else
                    inner = canonical_object(child, depth + 1)
                end
                segment = entry.key_raw .. entry.middle_raw .. "{"
                if inner ~= "" then
                    segment = segment .. inner
                end
                if child_meta == nil and inner ~= "" then
                    segment = segment .. "\n" .. string.rep("\t", depth)
                end
                segment = segment .. "}"
            end
        else
            local current = object[entry.key]
            if current ~= nil then
                local token
                if tostring(current) == entry.value then
                    token = entry.value_raw
                else
                    token = quote(current)
                end
                segment = entry.key_raw .. entry.middle_raw .. token
            end
        end
        if segment ~= nil then
            table.insert(parts, entry.lead_raw or "")
            table.insert(parts, segment)
            seen[entry.key] = true
        end
    end
    for _, key in ipairs(ordered_keys(object)) do
        if not seen[key] then
            local value = object[key]
            table.insert(parts, "\n")
            if type(value) == "table" then
                local inner = canonical_object(value, depth + 1)
                local block = string.rep("\t", depth) .. quote(key) .. "\n" .. string.rep("\t", depth) .. "{"
                if inner ~= "" then
                    block = block .. "\n" .. inner .. "\n" .. string.rep("\t", depth)
                end
                block = block .. "}"
                table.insert(parts, block)
            else
                table.insert(parts, string.rep("\t", depth) .. quote(key) .. "\t\t" .. quote(value))
            end
        end
    end
    table.insert(parts, meta.final_gap or "")
    return table.concat(parts)
end

---@param text string
---@return VdfState|nil, string|nil
local function parse(text)
    if type(text) ~= "string" then
        return nil, "vdf.parse expects a string"
    end

    local length = #text
    local position = 1

    ---@return string|nil
    local function skip_gap()
        local start = position
        while position <= length do
            local char = text:sub(position, position)
            if char == " " or char == "\t" or char == "\r" or char == "\n" then
                position = position + 1
            elseif char == "/" and text:sub(position, position + 1) == "//" then
                local newline = text:find("\n", position, true)
                position = newline or (length + 1)
            elseif char == "/" and text:sub(position, position + 1) == "/*" then
                local close = text:find("*/", position + 2, true)
                if close == nil then
                    return nil
                end
                position = close + 2
            else
                break
            end
        end
        return text:sub(start, position - 1)
    end

    ---@return string|nil, string|nil
    local function parse_string()
        position = position + 1
        local buffer = {}
        while position <= length do
            local char = text:sub(position, position)
            if char == '"' then
                position = position + 1
                return table.concat(buffer)
            elseif char == "\\" then
                local escaped = text:sub(position + 1, position + 1)
                if escaped == "" then
                    return nil, "unterminated escape sequence"
                elseif escaped == "n" then
                    table.insert(buffer, "\n")
                elseif escaped == "t" then
                    table.insert(buffer, "\t")
                elseif escaped == "r" then
                    table.insert(buffer, "\r")
                else
                    table.insert(buffer, escaped)
                end
                position = position + 2
            else
                table.insert(buffer, char)
                position = position + 1
            end
        end
        return nil, "unterminated string"
    end

    ---@return table|nil, string|nil
    local function parse_object()
        local object = {}
        local meta = { entries = {} }
        META[object] = meta
        position = position + 1
        local pending = skip_gap()
        if pending == nil then
            return nil, "unterminated block comment"
        end
        while true do
            if position > length then
                return nil, "unterminated object"
            end
            local char = text:sub(position, position)
            if char == "}" then
                meta.final_gap = pending
                position = position + 1
                return object
            elseif char == '"' then
                local key_start = position
                local key, key_err = parse_string()
                if key == nil then
                    return nil, key_err
                end
                local key_raw = text:sub(key_start, position - 1)
                local middle = skip_gap()
                if middle == nil then
                    return nil, "unterminated block comment"
                end
                local next_char = text:sub(position, position)
                if next_char == "{" then
                    local child, child_err = parse_object()
                    if child == nil then
                        return nil, child_err
                    end
                    table.insert(meta.entries, {
                        kind = "object",
                        key = key,
                        key_raw = key_raw,
                        middle_raw = middle,
                        lead_raw = pending,
                        child = child,
                    })
                    object[key] = child
                else
                    local value_start = position
                    local value, value_err = parse_string()
                    if value == nil then
                        return nil, value_err
                    end
                    table.insert(meta.entries, {
                        kind = "value",
                        key = key,
                        key_raw = key_raw,
                        middle_raw = middle,
                        lead_raw = pending,
                        value_raw = text:sub(value_start, position - 1),
                        value = value,
                    })
                    object[key] = value
                end
                pending = skip_gap()
                if pending == nil then
                    return nil, "unterminated block comment"
                end
            else
                return nil, "unexpected token: " .. char
            end
        end
    end

    local root = {}
    local meta = { entries = {} }
    META[root] = meta
    local pending = skip_gap()
    if pending == nil then
        return nil, "unterminated block comment"
    end
    while position <= length do
        local char = text:sub(position, position)
        if char ~= '"' then
            return nil, "unexpected token: " .. char
        end
        local key_start = position
        local key, key_err = parse_string()
        if key == nil then
            return nil, key_err
        end
        local key_raw = text:sub(key_start, position - 1)
        local middle = skip_gap()
        if middle == nil then
            return nil, "unterminated block comment"
        end
        local next_char = text:sub(position, position)
        if next_char == "{" then
            local child, child_err = parse_object()
            if child == nil then
                return nil, child_err
            end
            table.insert(meta.entries, {
                kind = "object",
                key = key,
                key_raw = key_raw,
                middle_raw = middle,
                lead_raw = pending,
                child = child,
            })
            root[key] = child
        else
            local value_start = position
            local value, value_err = parse_string()
            if value == nil then
                return nil, value_err
            end
            table.insert(meta.entries, {
                kind = "value",
                key = key,
                key_raw = key_raw,
                middle_raw = middle,
                lead_raw = pending,
                value_raw = text:sub(value_start, position - 1),
                value = value,
            })
            root[key] = value
        end
        pending = skip_gap()
        if pending == nil then
            return nil, "unterminated block comment"
        end
    end
    meta.final_gap = pending
    return root
end

---@param state VdfState
---@return string
local function serialize(state)
    if type(state) ~= "table" then
        return ""
    end
    local meta = META[state]
    if meta then
        return serialize_scanned(state, meta, 0)
    end
    local body = canonical_object(state, 0)
    if body == "" then
        return ""
    end
    return body .. "\n"
end

return {
    parse = parse,
    serialize = serialize,
}
