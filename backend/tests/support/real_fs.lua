local lfs = require("lfs")

local real_fs = {}

local function read_file(path)
    local file = io.open(path, "rb")
    if not file then
        return nil, "cannot open: " .. tostring(path)
    end
    local content = file:read("*a")
    file:close()
    return content, nil
end

local function write_file(path, content)
    local file, err = io.open(path, "wb")
    if not file then
        return nil, err or ("cannot open: " .. tostring(path))
    end
    file:write(content or "")
    file:close()
    return true, nil
end

local function parent(path)
    path = tostring(path):gsub("/+$", "")
    return path:match("^(.*)/[^/]+$") or "/"
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
    return result
end

function real_fs.new()
    local store = {}
    local fs = {}
    local utils = {}

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

    function fs.join(...)
        return join(...)
    end

    function fs.exists(path)
        return lfs.attributes(path) ~= nil
    end

    function fs.is_directory(path)
        local attributes = lfs.attributes(path)
        return attributes ~= nil and attributes.mode == "directory"
    end

    function fs.is_file(path)
        local attributes = lfs.attributes(path)
        return attributes ~= nil and attributes.mode == "file"
    end

    function fs.is_symlink(path)
        local attributes = lfs.attributes(path)
        return attributes ~= nil and attributes.mode == "link"
    end

    function fs.is_empty(path)
        local attributes = lfs.attributes(path)
        if attributes == nil then
            return false
        end
        if attributes.mode == "file" then
            return attributes.size == 0
        end
        local count = 0
        for name in lfs.dir(path) do
            if name ~= "." and name ~= ".." then
                count = count + 1
            end
        end
        return count == 0
    end

    local function ensure_directories(path)
        path = tostring(path):gsub("/+$", "")
        if path == "" or path == "/" then
            return true
        end
        local current = ""
        if path:sub(1, 1) == "/" then
            current = "/"
            path = path:sub(2)
        else
            local drive = path:match("^(%a:)")
            if drive then
                current = drive
                path = path:sub(3)
            end
        end
        for segment in path:gmatch("[^/]+") do
            if current == "" or current == "/" then
                current = current .. segment
            else
                current = current .. "/" .. segment
            end
            local attributes = lfs.attributes(current)
            if attributes == nil then
                local ok, err = lfs.mkdir(current)
                if not ok then
                    return nil, err or ("cannot create: " .. current)
                end
            elseif attributes.mode ~= "directory" then
                return nil, "not a directory: " .. current
            end
        end
        return true
    end

    function fs.create_directory(path)
        record("create_directory", path)
        local failure = take_failure("create_directory")
        if failure then
            return nil, failure
        end
        if lfs.attributes(path) then
            return false
        end
        local ok, err = lfs.mkdir(path)
        if not ok then
            return nil, err
        end
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
        if lfs.attributes(path) == nil then
            return false
        end
        if fs.is_directory(path) and not fs.is_empty(path) then
            return nil, "directory not empty"
        end
        local ok, err = os.remove(path)
        if not ok then
            return nil, err
        end
        return true
    end

    local function remove_tree(path)
        local attributes = lfs.attributes(path)
        if attributes == nil then
            return 0
        end
        local removed = 0
        if attributes.mode == "directory" then
            for name in lfs.dir(path) do
                if name ~= "." and name ~= ".." then
                    removed = removed + remove_tree(join(path, name))
                end
            end
            os.remove(path)
            removed = removed + 1
        else
            os.remove(path)
            removed = 1
        end
        return removed
    end

    function fs.remove_all(path)
        record("remove_all", path)
        local failure = take_failure("remove_all")
        if failure then
            return nil, failure
        end
        return remove_tree(path)
    end

    function fs.list(path)
        record("list", path)
        local failure = take_failure("list")
        if failure then
            return nil, failure
        end
        if not fs.is_directory(path) then
            return nil, "not a directory: " .. tostring(path)
        end
        local result = {}
        for name in lfs.dir(path) do
            if name ~= "." and name ~= ".." then
                local child = join(path, name)
                local attributes = lfs.attributes(child) or {}
                table.insert(result, {
                    name = name,
                    path = child,
                    is_directory = attributes.mode == "directory",
                    is_file = attributes.mode == "file",
                    is_symlink = attributes.mode == "link",
                    size = attributes.size,
                })
            end
        end
        table.sort(result, function(left, right)
            return left.name < right.name
        end)
        return result
    end

    function fs.list_recursive(path)
        record("list_recursive", path)
        local failure = take_failure("list_recursive")
        if failure then
            return nil, failure
        end
        local result = {}
        local queue = { path }
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
        if fs.is_directory(from) then
            return fs.copy_recursive(from, to)
        end
        local content, read_err = read_file(from)
        if content == nil then
            return nil, read_err
        end
        local created, create_err = ensure_directories(parent(to))
        if not created then
            return nil, create_err
        end
        local written, write_err = write_file(to, content)
        if not written then
            return nil, write_err
        end
        return true
    end

    function fs.copy_recursive(from, to)
        record("copy_recursive", from)
        local failure = take_failure("copy_recursive")
        if failure then
            return nil, failure
        end
        if not fs.is_directory(from) then
            return nil, "no such directory: " .. tostring(from)
        end
        local created, create_err = ensure_directories(to)
        if not created then
            return nil, create_err
        end
        for name in lfs.dir(from) do
            if name ~= "." and name ~= ".." then
                local source = join(from, name)
                local destination = join(to, name)
                if fs.is_directory(source) then
                    local ok, err = fs.copy_recursive(source, destination)
                    if not ok then
                        return nil, err
                    end
                else
                    local ok, err = fs.copy(source, destination)
                    if not ok then
                        return nil, err
                    end
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
        if lfs.attributes(from) == nil then
            return nil, "no such path: " .. tostring(from)
        end
        local created, create_err = ensure_directories(parent(to))
        if not created then
            return nil, create_err
        end
        if lfs.attributes(to) ~= nil then
            remove_tree(to)
        end
        local ok, err = os.rename(from, to)
        if not ok then
            return nil, err
        end
        return true
    end

    function fs.file_size(path)
        local attributes = lfs.attributes(path)
        if attributes == nil or attributes.mode ~= "file" then
            return nil, "not a file"
        end
        return attributes.size
    end

    function fs.last_write_time(path)
        local attributes = lfs.attributes(path)
        if attributes == nil then
            return nil, "not found"
        end
        return attributes.modification
    end

    function fs.current_path()
        return lfs.currentdir()
    end

    function fs.set_current_path(path)
        return lfs.chdir(path)
    end

    function fs.absolute(path)
        path = tostring(path)
        if path:sub(1, 1) == "/" then
            return path
        end
        return join(lfs.currentdir(), path)
    end

    function fs.canonical(path)
        return path
    end

    function fs.relative(path, base)
        base = base or lfs.currentdir()
        local prefix = base:gsub("/+$", "") .. "/"
        if path:sub(1, #prefix) == prefix then
            return path:sub(#prefix + 1)
        end
        return path
    end

    function fs.filename(path)
        return tostring(path):gsub("/+$", ""):match("([^/]+)$")
    end

    function fs.extension(path)
        local name = fs.filename(path)
        return name:match("(%.[^.]*)$") or ""
    end

    function fs.stem(path)
        local name = fs.filename(path)
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
        return read_file(path)
    end

    function utils.write_file(path, content)
        record("write", path)
        local failure = take_failure("write")
        if failure then
            return nil, failure
        end
        return write_file(path, content)
    end

    function utils.append_file(path, content)
        record("append", path)
        local failure = take_failure("append")
        if failure then
            return nil, failure
        end
        local existing = read_file(path) or ""
        return write_file(path, existing .. (content or ""))
    end

    function utils.time()
        return clock()
    end

    function utils.time_ms()
        return math.floor(clock() * 1000)
    end

    function utils.sleep() end

    function utils.trim(value)
        return (tostring(value):gsub("^%s*(.-)%s*$", "%1"))
    end

    function utils.startswith(value, prefix)
        return tostring(value):sub(1, #prefix) == prefix
    end

    function utils.endswith(value, suffix)
        return suffix == "" or tostring(value):sub(-#suffix) == suffix
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

    store.fs = fs
    store.utils = utils

    function store.seed(path, content)
        local created, err = ensure_directories(parent(path))
        if not created then
            error(err)
        end
        local written, write_err = utils.write_file(path, content)
        if not written then
            error(write_err)
        end
        return path
    end

    function store.seed_directory(path)
        local created, err = ensure_directories(path)
        if not created then
            error(err)
        end
        return path
    end

    function store.read(path)
        local content = read_file(path)
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
        store.calls = {}
        store.failures = {}
        store.hook = nil
    end

    return store
end

return real_fs
