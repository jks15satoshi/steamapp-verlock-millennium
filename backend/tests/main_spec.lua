local support = require("support")

describe("main", function()
    local main
    local store
    local logger

    local MANIFEST = "/steam/steamapps/appmanifest_440.acf"

    local BRIDGE_METHODS = {
        "lock_app",
        "refresh_app",
        "get_required_apps",
        "unlock_app",
        "list_locked",
        "restore_all",
        "get_data_root",
        "get_paths",
        "read_file",
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
        return invoke("lock_app", {
            appid = "440",
            dumps = { ["440"] = support.read_fixture("app_info_print_440.txt") },
        })
    end

    before_each(function()
        support.reset()
        support.install_json()
        store = support.use_fake_fs()
        logger = support.stub_logger()
        support.stub_millennium({ config = { data_root = "/data" } })
        support.set_env("MILLENNIUM__STEAM_PATH", "/steam")
        support.set_env("XDG_DATA_HOME", "/xdg/data")
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

    it("fails lock_app for a missing dump", function()
        store.seed(MANIFEST, support.read_fixture("appmanifest_440.acf"))
        local ack = invoke("lock_app", { appid = "440" })
        assert.is_table(ack)
        assert.is_false(ack.ok)
        assert.equals("a build info dump is required", ack.error)
        assert.equals("build_info_required", ack.code)
    end)

    it("fails lock_app for an echo-only dump", function()
        store.seed(MANIFEST, support.read_fixture("appmanifest_440.acf"))
        local ack = invoke("lock_app", {
            appid = "440",
            dumps = { ["440"] = "app_info_print 440\n" },
        })
        assert.is_table(ack)
        assert.is_false(ack.ok)
        assert.is_string(ack.error)
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
        local ack = invoke("refresh_app", {
            appid = "440",
            dumps = { ["440"] = support.read_fixture("app_info_print_440.txt") },
        })
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

    it("returns the manifest and lock paths from get_paths while locked", function()
        assert.is_true(seed_locked_440().ok)
        local paths = invoke("get_paths", { appid = "440" })
        assert.is_table(paths)
        assert.is_true(paths.ok)
        assert.equals(MANIFEST, paths.appmanifest)
        assert.equals("/data/locks/440.lock", paths.lock)
    end)

    it("returns only the discovered manifest from get_paths while unlocked", function()
        store.seed(MANIFEST, support.read_fixture("appmanifest_440.acf"))
        local paths = invoke("get_paths", { appid = "440" })
        assert.is_table(paths)
        assert.is_true(paths.ok)
        assert.equals(MANIFEST, paths.appmanifest)
        assert.is_nil(paths.lock)
    end)

    it("returns an empty result from get_paths when nothing is installed", function()
        local paths = invoke("get_paths", { appid = "440" })
        assert.is_table(paths)
        assert.is_true(paths.ok)
        assert.is_nil(paths.appmanifest)
        assert.is_nil(paths.lock)
    end)

    it("fails get_paths for a non-numeric appid", function()
        local ack = invoke("get_paths", { appid = "abc" })
        assert.is_table(ack)
        assert.is_false(ack.ok)
        assert.is_string(ack.error)
    end)

    it("returns the appmanifest text from read_file while locked", function()
        assert.is_true(seed_locked_440().ok)
        local result = invoke("read_file", { appid = "440", target = "appmanifest" })
        assert.is_true(result.ok)
        assert.is_string(result.content)
        assert.is_truthy(result.content:find('"appid"', 1, true))
    end)

    it("returns the lock record text from read_file", function()
        assert.is_true(seed_locked_440().ok)
        local result = invoke("read_file", { appid = "440", target = "lock" })
        assert.is_true(result.ok)
        assert.is_string(result.content)
        assert.is_truthy(result.content:find('"appid"', 1, true))
    end)

    it("returns the discovered appmanifest text from read_file while unlocked", function()
        store.seed(MANIFEST, support.read_fixture("appmanifest_440.acf"))
        local result = invoke("read_file", { appid = "440", target = "appmanifest" })
        assert.is_true(result.ok)
        assert.is_string(result.content)
    end)

    it("fails read_file for a non-numeric appid", function()
        local ack = invoke("read_file", { appid = "abc", target = "appmanifest" })
        assert.is_false(ack.ok)
        assert.is_string(ack.error)
    end)

    it("fails read_file for a lock record that does not exist", function()
        local ack = invoke("read_file", { appid = "440", target = "lock" })
        assert.is_false(ack.ok)
        assert.is_string(ack.error)
    end)

    it("fails read_file when the file is gone", function()
        assert.is_true(seed_locked_440().ok)
        store.delete(MANIFEST)
        local ack = invoke("read_file", { appid = "440", target = "appmanifest" })
        assert.is_false(ack.ok)
        assert.is_string(ack.error)
    end)

    it("fails read_file for an invalid target", function()
        assert.is_true(seed_locked_440().ok)
        local ack = invoke("read_file", { appid = "440", target = "other" })
        assert.is_false(ack.ok)
        assert.is_string(ack.error)
    end)

    it("fails read_file when the file is too large to display", function()
        store.seed(MANIFEST, string.rep("a", 512 * 1024 + 1))
        local ack = invoke("read_file", { appid = "440", target = "appmanifest" })
        assert.is_false(ack.ok)
        assert.is_string(ack.error)
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

    it("returns the root directory from get_data_root", function()
        local roots = invoke("get_data_root")
        assert.is_table(roots)
        assert.equals("/data", roots.data_root)
        assert.is_boolean(roots.is_default)
        assert.is_false(roots.is_default)
    end)

    it("returns the new data root from set_data_root", function()
        local target = support.host("/newdata")
        local ack = invoke("set_data_root", { path = target })
        assert.is_table(ack)
        assert.is_true(ack.ok)
        assert.equals(target, ack.data_root)
    end)

    it("resets to the default data root when given an empty path", function()
        local base
        if support.is_windows then
            base = support.host("/base")
            support.set_env("LOCALAPPDATA", base)
        else
            base = "/base"
            support.set_env("XDG_DATA_HOME", base)
        end
        local ack = invoke("set_data_root", { path = "" })
        assert.is_table(ack)
        assert.is_true(ack.ok)
        assert.equals(base .. "/steamapp-verlock", ack.data_root)
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
        local ack = invoke("lock_app", {
            appid = "730",
            dumps = { ["730"] = support.read_fixture("app_info_print_beta.txt") },
        })
        assert.is_true(ack.ok)
        assert.equals("30000001", ack.record.locked_build.buildid)
    end)

    it("defaults to the public branch when the appmanifest has no BetaKey", function()
        store.seed("/steam/steamapps/appmanifest_730.acf", support.read_fixture("appmanifest_730.acf"))
        local ack = invoke("lock_app", {
            appid = "730",
            dumps = { ["730"] = support.read_fixture("app_info_print_beta.txt") },
        })
        assert.is_true(ack.ok)
        assert.equals("30000000", ack.record.locked_build.buildid)
    end)

    it("returns the DLC apps the base PICS does not cover", function()
        local manifest = table.concat({
            '"AppState"',
            "{",
            '\t"appid"\t\t"440"',
            '\t"StateFlags"\t\t"4"',
            '\t"buildid"\t\t"12345678"',
            '\t"InstalledDepots"',
            "\t{",
            '\t\t"441"',
            "\t\t{",
            '\t\t\t"manifest"\t\t"7588696787324571854"',
            "\t\t}",
            '\t\t"443"',
            "\t\t{",
            '\t\t\t"manifest"\t\t"1000000000000000002"',
            '\t\t\t"dlcappid"\t\t"570"',
            "\t\t}",
            "\t}",
            "}",
        }, "\n")
        store.seed(MANIFEST, manifest)
        local ack = invoke("get_required_apps", {
            appid = "440",
            dump = support.read_fixture("app_info_print_440.txt"),
        })
        assert.is_table(ack)
        assert.is_true(ack.ok)
        assert.same({ "570" }, ack.apps)
    end)

    it("fails get_required_apps for a missing dump", function()
        store.seed(MANIFEST, support.read_fixture("appmanifest_440.acf"))
        local ack = invoke("get_required_apps", { appid = "440" })
        assert.is_table(ack)
        assert.is_false(ack.ok)
        assert.equals("a build info dump is required", ack.error)
    end)

    it("requests build info for every record on frontend load", function()
        assert.is_true(seed_locked_440().ok)
        store.seed("/steam/steamapps/appmanifest_570.acf", support.read_fixture("appmanifest_570.acf"))
        assert.is_true(invoke("lock_app", {
            appid = "570",
            dumps = { ["570"] = support.read_fixture("app_info_print_multi_depot.txt") },
        }).ok)

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
        local original = main.handlers.lock_app
        main.handlers.lock_app = function()
            error("boom", 0)
        end
        local ack = dispatch("lock_app", {})
        main.handlers.lock_app = original
        assert.is_false(ack.ok)
        assert.is_true(logged("error", "method lock_app failed: boom"))
    end)
end)
