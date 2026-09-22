local lfs = require("lfs")
local dkjson = require("dkjson")

local support = {}

support.is_windows = (type(jit) == "table" and jit.os == "Windows") or false

function support.host(path)
    if support.is_windows then
        return "C:" .. path
    end
    return path
end

local BACKEND_MODULES = { "vdf", "buildinfo", "acf", "state", "paths", "migrate", "lock", "log", "clock", "main" }

support.env = {}
support.tmpdirs = {}
support._now = nil
support._orig_time = os.time
support._orig_getenv = os.getenv
support.HIDDEN = {}

-- luacheck: push ignore 122
os.getenv = function(name)
    local value = rawget(support.env, name)
    if value == support.HIDDEN then
        return nil
    end
    if value ~= nil then
        return value
    end
    return support._orig_getenv(name)
end

-- luacheck: pop

local function json_decode(value)
    local decoded, _, err = dkjson.decode(value, 1, nil)
    if decoded == nil and err then
        error(err, 2)
    end
    return decoded
end

local function install_json()
    local json = {}
    function json.encode(value)
        return dkjson.encode(value)
    end
    function json.decode(value)
        return json_decode(value)
    end
    package.loaded["cjson"] = json
    package.loaded["json"] = json
end

function support.set_env(name, value)
    support.env[name] = value
end

function support.unset_env(name)
    support.env[name] = nil
end

function support.hide_env(name)
    support.env[name] = support.HIDDEN
end

-- luacheck: push ignore 122
function support.set_time(seconds)
    support._now = seconds
    os.time = function()
        return seconds
    end
end

function support.restore_time()
    os.time = support._orig_time
end

-- luacheck: pop

function support.reset()
    support.env = {}
    support._now = nil
    support.restore_time()
    for _, name in ipairs(BACKEND_MODULES) do
        package.loaded[name] = nil
    end
    package.loaded["millennium"] = nil
    package.loaded["logger"] = nil
    package.loaded["fs"] = nil
    package.loaded["utils"] = nil
    package.loaded["cjson"] = nil
    package.loaded["json"] = nil
    _G.Millennium = nil
    _G.millennium = nil
    _G.logger = nil
    support.fs = nil
    support.millennium = nil
end

function support.cleanup()
    support.restore_time()
    for _, directory in ipairs(support.tmpdirs) do
        support.remove_tree(directory)
    end
    support.tmpdirs = {}
end

function support.install_json()
    install_json()
end

function support.use_fake_fs()
    local fake = require("support.fake_fs").new()
    package.loaded["fs"] = fake.fs
    package.loaded["utils"] = fake.utils
    support.fs = fake
    return fake
end

function support.use_real_fs()
    local real = require("support.real_fs").new()
    package.loaded["fs"] = real.fs
    package.loaded["utils"] = real.utils
    support.fs = real
    return real
end

function support.stub_logger()
    local logger = {}
    local calls = {}
    logger.calls = calls
    function logger.info(_, message)
        table.insert(calls, { level = "info", message = message })
    end
    function logger.warn(_, message)
        table.insert(calls, { level = "warn", message = message })
    end
    function logger.error(_, message)
        table.insert(calls, { level = "error", message = message })
    end
    function logger.log() end
    function logger.debug() end
    package.loaded["logger"] = logger
    _G.logger = logger
    return logger
end

function support.stub_millennium(options)
    options = options or {}
    local config_values = {}
    for key, value in pairs(options.config or {}) do
        config_values[key] = value
    end
    local calls = {}
    local stub = {}
    stub.config_values = config_values
    stub.calls = calls
    stub.config = {
        get = function(key)
            return config_values[key], nil
        end,
        set = function(key, value)
            config_values[key] = value
            return true, nil
        end,
        delete = function(key)
            config_values[key] = nil
            return true, nil
        end,
        get_all = function()
            local copy = {}
            for key, value in pairs(config_values) do
                copy[key] = value
            end
            return copy, nil
        end,
        on_change = function()
            return function() end
        end,
    }
    function stub.ready()
        return true
    end
    function stub.version()
        return "2.0.0"
    end
    function stub.cmp_version()
        return 0
    end
    function stub.steam_path()
        return support.env["MILLENNIUM__STEAM_PATH"]
    end
    function stub.get_install_path()
        return support.env["MILLENNIUM__CONFIG_PATH"]
    end
    function stub.call_frontend_method(name, params)
        table.insert(calls, { name = name, params = params })
        return true
    end
    local datetime = {
        now = function()
            return os.time() * 1000
        end,
        unix = function()
            return os.time()
        end,
        from_unix = function(seconds)
            return seconds * 1000
        end,
        to_unix = function(milliseconds)
            return math.floor(milliseconds / 1000)
        end,
    }
    package.loaded["datetime"] = datetime
    package.loaded["millennium"] = stub
    _G.millennium = stub
    _G.Millennium = stub
    support.millennium = stub
    return stub
end

function support.load(...)
    local requested = { ... }
    for _, name in ipairs(BACKEND_MODULES) do
        package.loaded[name] = nil
    end
    if #requested == 0 then
        local modules = {}
        for _, name in ipairs(BACKEND_MODULES) do
            modules[name] = require(name)
        end
        return modules
    end
    local modules = {}
    for _, name in ipairs(requested) do
        modules[name] = require(name)
    end
    return modules
end

function support.require_fresh(name)
    for _, module_name in ipairs(BACKEND_MODULES) do
        package.loaded[module_name] = nil
    end
    return require(name)
end

local source = debug.getinfo(1, "S").source
local support_dir = source:sub(1, 1) == "@" and source:sub(2):match("^(.*)[/\\][^/\\]+$") or "backend/tests/support"
local tests_dir = support_dir .. "/.."

function support.fixtures_dir()
    return tests_dir .. "/fixtures"
end

function support.fixture_path(name)
    return support.fixtures_dir() .. "/" .. name
end

function support.read_fixture(name)
    local content
    if support.fs then
        content = support.fs.read(support.fixture_path(name))
    end
    if content == nil then
        local file = io.open(support.fixture_path(name), "rb")
        if not file then
            error("fixture not found: " .. name)
        end
        content = file:read("*a")
        file:close()
    end
    return content
end

support._tmp_counter = 0

function support.tmpdir(prefix)
    local base = os.getenv("TMPDIR")
    if base == nil or base == "" then
        base = os.getenv("TEMP")
    end
    if base == nil or base == "" then
        base = os.getenv("TMP")
    end
    if base == nil or base == "" then
        base = support.is_windows and "." or "/tmp"
    end
    base = tostring(base):gsub("\\", "/"):gsub("/+$", "")
    support._tmp_counter = support._tmp_counter + 1
    local suffix = prefix and ("-" .. prefix) or ""
    local directory = string.format("%s/verlock-test-%d-%d%s", base, os.time(), support._tmp_counter, suffix)
    local ok, err = lfs.mkdir(directory)
    if not ok then
        error(err or ("cannot create temporary directory: " .. directory))
    end
    table.insert(support.tmpdirs, directory)
    return directory
end

function support.mkdir(path)
    local created, err = lfs.mkdir(path)
    if not created and lfs.attributes(path) == nil then
        error(err or ("cannot create directory: " .. path))
    end
    return path
end

function support.remove_tree(path)
    local attributes = lfs.attributes(path)
    if attributes == nil then
        return
    end
    if attributes.mode == "directory" then
        for name in lfs.dir(path) do
            if name ~= "." and name ~= ".." then
                support.remove_tree(path .. "/" .. name)
            end
        end
        lfs.rmdir(path)
    else
        os.remove(path)
    end
end

function support.is_failure(value)
    return value == nil or value == false
end

function support.record(appid, options)
    options = options or {}
    return {
        version = options.version or 1,
        appid = tostring(appid),
        name = options.name or ("App " .. tostring(appid)),
        manifest_path = options.manifest_path or "",
        locked_at = options.locked_at or 1000,
        refreshed_at = options.refreshed_at,
        auto_update_behavior = options.auto_update_behavior,
        locked_build = options.locked_build or { buildid = "1", depots = {} },
        original = options.original or "",
    }
end

return support
