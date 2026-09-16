local fake_fs = {}

local function normalize(path)
    if path == nil then
        return nil
    end
    path = tostring(path)
    if path == "" then
        return ""
    end
    path = path:gsub("\\", "/")
    local absolute = path:sub(1, 1) == "/"
    local segments = {}
    for segment in path:gmatch("[^/]+") do
        if segment == "." then
            if not absolute and #segments == 0 then
                table.insert(segments, ".")
            end
        elseif segment == ".." then
            if #segments > 0 and segments[#segments] ~= ".." and segments[#segments] ~= "." then
                table.remove(segments)
            elseif not absolute then
                table.insert(segments, "..")
            end
        else
            table.insert(segments, segment)
        end
    end
    local result = table.concat(segments, "/")
    if absolute then
        result = "/" .. result
    end
    if result == "" then
        return absolute and "/" or "."
    end
    return result
end

local function parent(path)
    path = normalize(path)
    if path == "/" or path == "" or path == "." then
        return path
    end
    local trimmed = path:gsub("/+$", "")
    return trimmed:match("^(.*)/[^/]+$") or "/"
end

local function basename(path)
    path = tostring(path):gsub("/+$", "")
    return path:match("([^/]+)$") or path
end

local function join(...)
    local parts = { ... }
    local result = ""
    for index, part in ipairs(parts) do
        part = tostring(part)
        if index == 1 then
            result = part
        else
            if result:sub(-1) ~= "/" and part:sub(1, 1) ~= "/" then
                result = result .. "/"
            end
            result = result .. part
        end
    end
    return normalize(result)
end

function fake_fs.new()
    local store = {}
    local fs = {}
    local utils = {}

    store.nodes = { ["/"] = { kind = "dir", mtime = 0 } }
    store.calls = {}
    store.failures = {}
    store.hook = nil

    local function clock()
        return os.time()
    end

    local function take_failure(op)
        local queue = store.failures[op]
        if queue and #queue > 0 then
            return table.remove(queue)
        end
        return nil
    end

    local function record(op, path)
        store.calls[op] = (store.calls[op] or 0) + 1
        if store.hook then
            store.hook(op, path)
        end
    end

    local function get(path)
        return store.nodes[normalize(path)]
    end

    local function children(path)
        path = normalize(path)
        local prefix = path == "/" and "/" or (path .. "/")
        local result = {}
        for node_path, node in pairs(store.nodes) do
            if node_path ~= path and node_path:sub(1, #prefix) == prefix then
                local remainder = node_path:sub(#prefix + 1)
                if remainder ~= "" and not remainder:find("/", 1, true) then
                    result[remainder] = node
                end
            end
        end
        return result
    end

    local function drop_tree(path)
        path = normalize(path)
        local prefix = path == "/" and "/" or (path .. "/")
        local removed = 0
        for node_path in pairs(store.nodes) do
            if node_path == path or node_path:sub(1, #prefix) == prefix then
                store.nodes[node_path] = nil
                removed = removed + 1
            end
        end
        return removed
    end

    local function ensure_directories(path)
        path = normalize(path)
        if path == "/" or path == "" then
            return true
        end
        local segments = {}
        for segment in path:gmatch("[^/]+") do
            table.insert(segments, segment)
        end
        local current = ""
        for _, segment in ipairs(segments) do
            current = current .. "/" .. segment
            local node = store.nodes[current]
            if node == nil then
                store.nodes[current] = { kind = "dir", mtime = clock() }
            elseif node.kind ~= "dir" then
                return nil, "not a directory: " .. current
            end
        end
        return true
    end

    function fs.join(...)
        return join(...)
    end

    function fs.exists(path)
        return get(path) ~= nil
    end

    function fs.is_directory(path)
        local node = get(path)
        return node ~= nil and node.kind == "dir"
    end

    function fs.is_file(path)
        local node = get(path)
        return node ~= nil and node.kind == "file"
    end

    function fs.is_symlink()
        return false
    end

    function fs.is_empty(path)
        local node = get(path)
        if node == nil then
            return false
        end
        if node.kind == "file" then
            return node.content == ""
        end
        return next(children(path)) == nil
    end

    function fs.create_directory(path)
        record("create_directory", path)
        local failure = take_failure("create_directory")
        if failure then
            return nil, failure
        end
        path = normalize(path)
        if store.nodes[path] then
            return false
        end
        if path ~= "/" and not fs.is_directory(parent(path)) then
            return nil, "parent does not exist"
        end
        store.nodes[path] = { kind = "dir", mtime = clock() }
        return true
    end

    function fs.create_directories(path)
        record("create_directories", path)
        local failure = take_failure("create_directories")
        if failure then
            return nil, failure
        end
        return ensure_directories(path)
    end

    function fs.remove(path)
        record("remove", path)
        local failure = take_failure("remove")
        if failure then
            return nil, failure
        end
        path = normalize(path)
        local node = store.nodes[path]
        if node == nil then
            return false
        end
        if node.kind == "dir" and next(children(path)) ~= nil then
            return nil, "directory not empty"
        end
        store.nodes[path] = nil
        return true
    end

    function fs.remove_all(path)
        record("remove_all", path)
        local failure = take_failure("remove_all")
        if failure then
            return nil, failure
        end
        if get(path) == nil then
            return 0
        end
        return drop_tree(path)
    end

    function fs.list(path)
        record("list", path)
        local failure = take_failure("list")
        if failure then
            return nil, failure
        end
        path = normalize(path)
        if not fs.is_directory(path) then
            return nil, "not a directory: " .. tostring(path)
        end
        local result = {}
        local names = {}
        local indexed = children(path)
        for name in pairs(indexed) do
            table.insert(names, name)
        end
        table.sort(names)
        for _, name in ipairs(names) do
            local node = indexed[name]
            local child_path = join(path, name)
            table.insert(result, {
                name = name,
                path = child_path,
                is_directory = node.kind == "dir",
                is_file = node.kind == "file",
                is_symlink = false,
                size = node.kind == "file" and #node.content or nil,
            })
        end
        return result
    end

    function fs.list_recursive(path)
        record("list_recursive", path)
        local failure = take_failure("list_recursive")
        if failure then
            return nil, failure
        end
        local result = {}
        local queue = { normalize(path) }
        while #queue > 0 do
            local current = table.remove(queue, 1)
            local entries = fs.list(current)
            for _, entry in ipairs(entries or {}) do
                table.insert(result, entry)
                if entry.is_directory then
                    table.insert(queue, entry.path)
                end
            end
        end
        return result
    end

    function fs.copy(from, to)
        record("copy", from)
        local failure = take_failure("copy")
        if failure then
            return nil, failure
        end
        local node = get(from)
        if node == nil then
            return nil, "no such file: " .. tostring(from)
        end
        if node.kind == "dir" then
            return fs.copy_recursive(from, to)
        end
        local parent_ok, parent_err = ensure_directories(parent(to))
        if not parent_ok then
            return nil, parent_err
        end
        store.nodes[normalize(to)] = { kind = "file", content = node.content, mtime = clock() }
        return true
    end

    function fs.copy_recursive(from, to)
        record("copy_recursive", from)
        local failure = take_failure("copy_recursive")
        if failure then
            return nil, failure
        end
        if get(from) == nil then
            return nil, "no such directory: " .. tostring(from)
        end
        local ok, err = ensure_directories(to)
        if not ok then
            return nil, err
        end
        local entries = fs.list_recursive(from) or {}
        for _, entry in ipairs(entries) do
            local relative = entry.path:sub(#normalize(from) + 2)
            local destination = join(to, relative)
            if entry.is_directory then
                local created, create_err = ensure_directories(destination)
                if not created then
                    return nil, create_err
                end
            else
                local copied, copy_err = fs.copy(entry.path, destination)
                if not copied then
                    return nil, copy_err
                end
            end
        end
        return true
    end

    function fs.rename(from, to)
        record("rename", from)
        local failure = take_failure("rename")
        if failure then
            return nil, failure
        end
        local node = get(from)
        if node == nil then
            return nil, "no such path: " .. tostring(from)
        end
        local destination_parent = parent(to)
        local parent_ok, parent_err = ensure_directories(destination_parent)
        if not parent_ok then
            return nil, parent_err
        end
        if node.kind == "file" then
            store.nodes[normalize(to)] = node
            store.nodes[normalize(from)] = nil
            return true
        end
        local source = normalize(from)
        local target = normalize(to)
        local prefix = source .. "/"
        local moves = {}
        for node_path, value in pairs(store.nodes) do
            if node_path == source then
                table.insert(moves, { from = node_path, to = target, value = value })
            elseif node_path:sub(1, #prefix) == prefix then
                table.insert(moves, { from = node_path, to = target .. node_path:sub(#source + 1), value = value })
            end
        end
        for _, move in ipairs(moves) do
            store.nodes[move.from] = nil
        end
        for _, move in ipairs(moves) do
            store.nodes[move.to] = move.value
        end
        return true
    end

    function fs.file_size(path)
        local node = get(path)
        if node == nil or node.kind ~= "file" then
            return nil, "not a file"
        end
        return #node.content
    end

    function fs.last_write_time(path)
        local node = get(path)
        if node == nil then
            return nil, "not found"
        end
        return node.mtime
    end

    function fs.current_path()
        return "/"
    end

    function fs.set_current_path()
        return true
    end

    function fs.absolute(path)
        path = tostring(path)
        if path:sub(1, 1) == "/" then
            return normalize(path)
        end
        return normalize("/" .. path)
    end

    function fs.canonical(path)
        return normalize(path)
    end

    function fs.relative(path, base)
        path = normalize(path)
        base = normalize(base or "/")
        local prefix = base == "/" and "/" or (base .. "/")
        if path == base then
            return "."
        end
        if path:sub(1, #prefix) == prefix then
            return path:sub(#prefix + 1)
        end
        return path
    end

    function fs.filename(path)
        return basename(path)
    end

    function fs.extension(path)
        local name = basename(path)
        return name:match("(%.[^.]*)$") or ""
    end

    function fs.stem(path)
        local name = basename(path)
        return (name:gsub("%.[^.]*$", ""))
    end

    function fs.parent_path(path)
        return parent(path)
    end

    function fs.space_info()
        return { capacity = 1099511627776, free = 1099511627776, available = 1099511627776 }
    end

    function utils.read_file(path)
        record("read", path)
        local failure = take_failure("read")
        if failure then
            return nil, failure
        end
        local node = get(path)
        if node == nil or node.kind ~= "file" then
            return nil, "no such file: " .. tostring(path)
        end
        return node.content, nil
    end

    function utils.write_file(path, content)
        record("write", path)
        local failure = take_failure("write")
        if failure then
            return nil, failure
        end
        local ok, err = ensure_directories(parent(path))
        if not ok then
            return nil, err
        end
        store.nodes[normalize(path)] = { kind = "file", content = content or "", mtime = clock() }
        return true, nil
    end

    function utils.append_file(path, content)
        record("append", path)
        local failure = take_failure("append")
        if failure then
            return nil, failure
        end
        local node = get(path)
        local existing = node and node.kind == "file" and node.content or ""
        return utils.write_file(path, existing .. (content or ""))
    end

    function utils.time()
        return clock()
    end

    function utils.time_ms()
        return math.floor(clock() * 1000)
    end

    function utils.sleep() end

    function utils.split(value, delimiter)
        local result = {}
        local pattern = "([^" .. delimiter .. "]+)"
        for part in tostring(value):gmatch(pattern) do
            table.insert(result, part)
        end
        return result
    end

    function utils.trim(value)
        return (tostring(value):gsub("^%s*(.-)%s*$", "%1"))
    end

    function utils.ltrim(value)
        return (tostring(value):gsub("^%s*", ""))
    end

    function utils.rtrim(value)
        return (tostring(value):gsub("%s*$", ""))
    end

    function utils.startswith(value, prefix)
        return tostring(value):sub(1, #prefix) == prefix
    end

    function utils.endswith(value, suffix)
        return suffix == "" or tostring(value):sub(-#suffix) == suffix
    end

    function utils.join(values, delimiter)
        return table.concat(values, delimiter or "")
    end

    function utils.getenv(name)
        return os.getenv(name)
    end

    function utils.setenv(name, value)
        _G.__VERLOCK_TEST_ENV = _G.__VERLOCK_TEST_ENV or {}
        _G.__VERLOCK_TEST_ENV[name] = value
        return true
    end

    function utils.get_backend_path()
        return "/backend"
    end

    function utils.uuid()
        return "00000000-0000-4000-8000-000000000000"
    end

    function utils.base64_encode(value)
        return value
    end

    function utils.round(value)
        return math.floor(value + 0.5)
    end

    function utils.clamp(value, minimum, maximum)
        return math.max(minimum, math.min(maximum, value))
    end

    store.fs = fs
    store.utils = utils

    function store.seed(path, content)
        local ok, err = utils.write_file(path, content)
        if not ok then
            error(err)
        end
        return path
    end

    function store.seed_directory(path)
        local ok, err = ensure_directories(path)
        if not ok then
            error(err)
        end
        return path
    end

    function store.read(path)
        local content = utils.read_file(path)
        return content
    end

    function store.exists(path)
        return fs.exists(path)
    end

    function store.delete(path)
        return fs.remove_all(path)
    end

    function store.fail_next(op, err)
        store.failures[op] = store.failures[op] or {}
        table.insert(store.failures[op], err or ("injected failure: " .. op))
    end

    function store.fail_ops(ops, err)
        for op in pairs(ops) do
            for _ = 1, 100 do
                store.fail_next(op, err)
            end
        end
    end

    function store.reset()
        store.nodes = { ["/"] = { kind = "dir", mtime = 0 } }
        store.calls = {}
        store.failures = {}
        store.hook = nil
    end

    return store
end

return fake_fs
