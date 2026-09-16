local support = require("support")

describe("main", function()
    local main
    local store
    local logger

    local CACHE_ROOT = "/xdg/cache/steamapp-verlock"
    local MANIFEST = "/steam/steamapps/appmanifest_440.acf"

    local BRIDGE_METHODS = {
        "set_build_info",
        "lock_app",
        "refresh_app",
        "unlock_app",
        "list_locked",
        "restore_all",
        "get_data_root",
        "set_data_root",
        "reapply_app",
        "append_log",
    }

    local function methods_table()
        if type(main.methods) == "table" then
            return main.methods
        end
        if type(main.handlers) == "table" then
            return main.handlers
        end
        return main
    end

    local function handler_for(name)
        local candidate = methods_table()[name]
        if type(candidate) == "function" then
            return candidate
        end
        if type(_G[name]) == "function" then
            return _G[name]
        end
        return nil
    end

    local function dispatch(name, payload)
        if type(main.dispatch) == "function" then
            return main.dispatch(name, payload)
        end
        local handler = handler_for(name)
        if not handler then
            return { ok = false, error = "unknown method: " .. name }
        end
        return handler(payload)
    end

    local function decode(value)
        if type(value) ~= "string" then
            return value
        end
        local ok, decoded = pcall(require("json").decode, value)
        assert.is_true(ok)
        return decoded
    end

    local function invoke(name, payload)
        local raw = _G[name]
        assert.is_function(raw)
        if payload == nil then
            return decode(raw())
        end
        return decode(raw(require("json").encode(payload)))
    end

    local function logged(level, fragment)
        for _, call in ipairs(logger.calls) do
            if call.level == level and call.message:find(fragment, 1, true) ~= nil then
                return true
            end
        end
        return false
    end

    local function seed_locked_440()
        store.seed(MANIFEST, support.read_fixture("appmanifest_440.acf"))
        store.seed(CACHE_ROOT .. "/buildinfo/440.kv", support.read_fixture("app_info_print_440.txt"))
        return invoke("lock_app", { appid = "440" })
    end

    before_each(function()
        support.reset()
        support.install_json()
        store = support.use_fake_fs()
        logger = support.stub_logger()
        support.stub_millennium({ config = { data_root = "/data" } })
        support.set_env("MILLENNIUM__STEAM_PATH", "/steam")
        support.set_env("XDG_DATA_HOME", "/xdg/data")
        support.set_env("XDG_CACHE_HOME", "/xdg/cache")
        main = support.require_fresh("main")
    end)

    after_each(function()
        support.cleanup()
    end)

    it("returns the lifecycle functions", function()
        assert.is_function(main.on_load)
        assert.is_function(main.on_unload)
        assert.is_function(main.on_frontend_loaded)
    end)

    it("returns nothing from on_load", function()
        assert.is_nil(main.on_load())
    end)

    it("exposes every frontend-to-backend bridge method", function()
        for _, name in ipairs(BRIDGE_METHODS) do
            assert.is_function(handler_for(name))
        end
    end)

    it("dispatches a method through the dispatcher", function()
        local roots = dispatch("get_data_root", {})
        assert.is_table(roots)
        assert.is_not_nil(roots.data_root)
    end)

    it("returns an Ack envelope", function()
        local ack = dispatch("set_data_root", { path = "relative" })
        assert.is_table(ack)
        assert.is_true(support.is_failure(ack.ok))
        assert.is_string(ack.error)
    end)

    it("returns an error for an unknown method", function()
        local ack = dispatch("does_not_exist", {})
        assert.is_table(ack)
        assert.is_true(support.is_failure(ack.ok))
        assert.is_string(ack.error)
    end)

    it("returns a success Ack from set_build_info for a valid dump", function()
        local ack = invoke("set_build_info", {
            appid = "440",
            dump = support.read_fixture("app_info_print_440.txt"),
        })
        assert.is_table(ack)
        assert.is_true(ack.ok)
        assert.is_nil(ack.error)
        assert.is_nil(ack.code)
    end)

    it("fails set_build_info for a non-numeric appid", function()
        local ack = invoke("set_build_info", { appid = "four-forty", dump = "dump" })
        assert.is_table(ack)
        assert.is_false(ack.ok)
        assert.is_string(ack.error)
        assert.equals("a numeric appid is required", ack.error)
        assert.is_nil(ack.code)
    end)

    it("fails set_build_info for a missing appid", function()
        local ack = invoke("set_build_info", { dump = "dump" })
        assert.is_table(ack)
        assert.is_false(ack.ok)
        assert.equals("a numeric appid is required", ack.error)
        assert.is_nil(ack.code)
    end)

    it("fails set_build_info for a missing dump", function()
        local ack = invoke("set_build_info", { appid = "440" })
        assert.is_table(ack)
        assert.is_false(ack.ok)
        assert.equals("a build info dump is required", ack.error)
        assert.is_nil(ack.code)
    end)

    it("returns an Ack with a lock record from lock_app", function()
        local ack = seed_locked_440()
        assert.is_true(ack.ok)
        local record = ack.record
        assert.is_table(record)
        assert.equals(1, record.version)
        assert.equals("440", record.appid)
        assert.is_string(record.name)
        assert.is_string(record.manifest_path)
        assert.is_number(record.locked_at)
        assert.is_table(record.locked_build)
        assert.is_string(record.locked_build.buildid)
        assert.is_table(record.locked_build.depots)
        assert.is_string(record.original)
    end)

    it("returns an Ack from refresh_app", function()
        assert.is_true(seed_locked_440().ok)
        local ack = invoke("refresh_app", { appid = "440" })
        assert.is_table(ack)
        assert.is_true(ack.ok)
    end)

    it("returns an Ack from unlock_app", function()
        assert.is_true(seed_locked_440().ok)
        local ack = invoke("unlock_app", { appid = "440" })
        assert.is_table(ack)
        assert.is_true(ack.ok)
    end)

    it("returns an array of records from list_locked", function()
        assert.is_true(seed_locked_440().ok)
        local locked = invoke("list_locked")
        assert.is_table(locked)
        assert.equals(1, #locked)
        assert.is_table(locked[1])
        assert.equals("440", locked[1].appid)
        assert.is_string(locked[1].manifest_path)
        assert.is_table(locked[1].locked_build)
    end)

    it("returns restored and failed from restore_all", function()
        assert.is_true(seed_locked_440().ok)
        local ack = invoke("restore_all")
        assert.is_table(ack)
        assert.is_true(ack.ok)
        assert.is_number(ack.restored)
        assert.equals(1, ack.restored)
        assert.is_table(ack.failed)
        assert.equals(0, #ack.failed)
    end)

    it("returns the root directories from get_data_root", function()
        local roots = invoke("get_data_root")
        assert.is_table(roots)
        assert.equals("/data", roots.data_root)
        assert.equals(CACHE_ROOT, roots.cache_root)
        assert.is_boolean(roots.is_default)
        assert.is_false(roots.is_default)
    end)

    it("returns the new data root from set_data_root", function()
        local ack = invoke("set_data_root", { path = "/newdata" })
        assert.is_table(ack)
        assert.is_true(ack.ok)
        assert.equals("/newdata", ack.data_root)
    end)

    it("resets to the default data root when it contains the cache root", function()
        support.set_env("XDG_DATA_HOME", "/base")
        support.set_env("XDG_CACHE_HOME", "/base/steamapp-verlock")
        local ack = invoke("set_data_root", { path = "" })
        assert.is_table(ack)
        assert.is_true(ack.ok)
        assert.equals("/base/steamapp-verlock", ack.data_root)
        assert.is_true(ack.is_default)
    end)

    it("returns code not_installed from reapply_app on a confirmed absence", function()
        assert.is_true(seed_locked_440().ok)
        store.delete(MANIFEST)
        local ack = invoke("reapply_app", { appid = "440" })
        assert.is_table(ack)
        assert.is_false(ack.ok)
        assert.equals("not_installed", ack.code)
    end)

    it("returns a success Ack from append_log and relays a frontend record", function()
        local ack = invoke("append_log", { level = "info", message = "hello" })
        assert.is_table(ack)
        assert.is_true(ack.ok)
        assert.equals(1, #logger.calls)
        assert.equals("info", logger.calls[1].level)
        assert.is_truthy(logger.calls[1].message:find("[frontend] hello", 1, true))
    end)

    it("fails append_log for an invalid level", function()
        local ack = invoke("append_log", { level = "debug", message = "hello" })
        assert.is_table(ack)
        assert.is_false(ack.ok)
        assert.is_string(ack.error)
    end)

    it("fails append_log for a missing message", function()
        local ack = invoke("append_log", { level = "warn" })
        assert.is_table(ack)
        assert.is_false(ack.ok)
        assert.is_string(ack.error)
    end)

    it("reads the beta branch from the appmanifest BetaKey", function()
        store.seed("/steam/steamapps/appmanifest_730.acf", support.read_fixture("appmanifest_730_beta.acf"))
        store.seed(CACHE_ROOT .. "/buildinfo/730.kv", support.read_fixture("app_info_print_beta.txt"))
        local ack = invoke("lock_app", { appid = "730" })
        assert.is_true(ack.ok)
        assert.equals("30000001", ack.record.locked_build.buildid)
    end)

    it("defaults to the public branch when the appmanifest has no BetaKey", function()
        store.seed("/steam/steamapps/appmanifest_730.acf", support.read_fixture("appmanifest_730.acf"))
        store.seed(CACHE_ROOT .. "/buildinfo/730.kv", support.read_fixture("app_info_print_beta.txt"))
        local ack = invoke("lock_app", { appid = "730" })
        assert.is_true(ack.ok)
        assert.equals("30000000", ack.record.locked_build.buildid)
    end)

    it("requests build info for every record on frontend load", function()
        assert.is_true(seed_locked_440().ok)
        store.seed("/steam/steamapps/appmanifest_570.acf", support.read_fixture("appmanifest_570.acf"))
        store.seed(CACHE_ROOT .. "/buildinfo/570.kv", support.read_fixture("app_info_print_multi_depot.txt"))
        assert.is_true(invoke("lock_app", { appid = "570" }).ok)

        main.on_frontend_loaded()

        local requested = {}
        for _, call in ipairs(support.millennium.calls) do
            if call.name == "request_build_info" then
                requested[tostring(call.params[1])] = true
            end
        end
        assert.is_true(requested["440"])
        assert.is_true(requested["570"])
    end)

    it("rejects list_locked while a migration runs", function()
        assert.is_true(seed_locked_440().ok)
        local state = require("state")
        state.set_migrating(true)
        local ack = dispatch("list_locked", {})
        state.set_migrating(false)
        assert.is_table(ack)
        assert.is_false(ack.ok)
        assert.is_string(ack.error)
    end)

    it("logs an error when a handler raises", function()
        local original = main.handlers.set_build_info
        main.handlers.set_build_info = function()
            error("boom", 0)
        end
        local ack = dispatch("set_build_info", {})
        main.handlers.set_build_info = original
        assert.is_false(ack.ok)
        assert.is_true(logged("error", "method set_build_info failed: boom"))
    end)

    it("logs an error when the build info cannot be stored", function()
        store.fail_next("write", "permission denied")
        local ack = invoke("set_build_info", { appid = "440", dump = "dump" })
        assert.is_false(ack.ok)
        assert.is_true(logged("error", "store failed for app 440"))
    end)
end)
