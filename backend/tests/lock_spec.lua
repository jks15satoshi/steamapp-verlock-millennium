local support = require("support")

describe("lock", function()
    local lock
    local state
    local paths
    local store

    local MANIFEST = "/steam/steamapps/appmanifest_440.acf"
    local MANIFEST_570 = "/steam/steamapps/appmanifest_570.acf"

    local ORIGINAL = table.concat({
        '"AppState"',
        "{",
        '\t"appid"\t\t"440"',
        '\t"name"\t\t"Team Fortress 2"',
        '\t"StateFlags"\t\t"4"',
        '\t"buildid"\t\t"10000000"',
        '\t"InstalledDepots"',
        "\t{",
        '\t\t"441"',
        "\t\t{",
        '\t\t\t"manifest"\t\t"1000000000000000001"',
        "\t\t}",
        "\t}",
        "}",
        "",
    }, "\n")

    local ORIGINAL_570 = table.concat({
        '"AppState"',
        "{",
        '\t"appid"\t\t"570"',
        '\t"name"\t\t"Dota 2"',
        '\t"StateFlags"\t\t"4"',
        '\t"buildid"\t\t"10000000"',
        '\t"InstalledDepots"',
        "\t{",
        '\t\t"570"',
        "\t\t{",
        '\t\t\t"manifest"\t\t"1000000000000000001"',
        "\t\t}",
        "\t}",
        "}",
        "",
    }, "\n")

    local STEAM_REWRITTEN = table.concat({
        '"AppState"',
        "{",
        '\t"appid"\t\t"440"',
        '\t"StateFlags"\t\t"2"',
        '\t"buildid"\t\t"30000000"',
        '\t"InstalledDepots"',
        "\t{",
        '\t\t"441"',
        "\t\t{",
        '\t\t\t"manifest"\t\t"3000000000000000003"',
        "\t\t}",
        "\t}",
        "}",
        "",
    }, "\n")

    local EXTRA_DEPOT = table.concat({
        '"AppState"',
        "{",
        '\t"appid"\t\t"440"',
        '\t"StateFlags"\t\t"4"',
        '\t"TargetBuildID"\t\t"0"',
        '\t"buildid"\t\t"12345678"',
        '\t"InstalledDepots"',
        "\t{",
        '\t\t"441"',
        "\t\t{",
        '\t\t\t"manifest"\t\t"7588696787324571854"',
        "\t\t}",
        '\t\t"442"',
        "\t\t{",
        '\t\t\t"manifest"\t\t"1000000000000000002"',
        "\t\t}",
        "\t}",
        "}",
        "",
    }, "\n")

    local INFO = { buildid = "12345678", depots = { ["441"] = "7588696787324571854" } }
    local INFO_570 = {
        buildid = "20000000",
        depots = {
            ["570"] = "1111111111111111111",
            ["571"] = "2222222222222222222",
            ["580"] = "3333333333333333333",
        },
    }

    local function setup()
        support.reset()
        support.install_json()
        store = support.use_fake_fs()
        support.stub_logger()
        support.stub_millennium({ config = { data_root = "/data" } })
        support.set_env("MILLENNIUM__STEAM_PATH", "/steam")
        support.set_env("XDG_DATA_HOME", "/xdg/data")
        support.set_env("XDG_CACHE_HOME", "/xdg/cache")
        store.seed_directory("/steam/steamapps")
        store.seed("/steam/steamapps/libraryfolders.vdf", support.read_fixture("libraryfolders.vdf"))
        store.seed(MANIFEST, ORIGINAL)
        store.seed(MANIFEST_570, ORIGINAL_570)
        support.set_time(1000)
        local modules = support.load("lock", "state", "paths")
        lock = modules.lock
        state = modules.state
        paths = modules.paths
    end

    before_each(setup)

    after_each(function()
        support.cleanup()
    end)

    it("locks an app and records the verbatim original", function()
        local result = lock.lock("440", INFO)
        assert.is_true(result.ok)
        local written = store.read(MANIFEST)
        assert.is_not_nil(written:find('"StateFlags"%s+"4"'))
        assert.is_not_nil(written:find('"TargetBuildID"%s+"0"'))
        assert.is_not_nil(written:find('"buildid"%s+"12345678"'))
        assert.is_not_nil(written:find('"7588696787324571854"'))
        local record = state.read("440")
        assert.is_not_nil(record)
        assert.equals(ORIGINAL, record.original)
        assert.same(INFO, record.locked_build)
        assert.equals(1000, record.locked_at)
    end)

    it("refreshes an already locked app", function()
        assert.is_true(lock.lock("440", INFO).ok)
        support.set_time(2000)
        local refreshed = { buildid = "22345678", depots = { ["441"] = "9999999999999999999" } }
        local result = lock.refresh("440", refreshed)
        assert.is_true(result.ok)
        local record = state.read("440")
        assert.equals("22345678", record.locked_build.buildid)
        assert.equals("9999999999999999999", record.locked_build.depots["441"])
        assert.equals(2000, record.refreshed_at)
        assert.is_not_nil(store.read(MANIFEST):find('"buildid"%s+"22345678"'))
    end)

    it("unlocks an app and restores the original text", function()
        assert.is_true(lock.lock("440", INFO).ok)
        local result = lock.unlock("440")
        assert.is_true(result.ok)
        assert.equals(ORIGINAL, store.read(MANIFEST))
        assert.is_nil(state.read("440"))
    end)

    it("does not rewrite an appmanifest that already matches", function()
        assert.is_true(lock.lock("440", INFO).ok)
        local writes_before = store.calls.write or 0
        local renames_before = store.calls.rename or 0
        local result = lock.reapply("440")
        assert.is_true(result.ok)
        assert.equals(writes_before, store.calls.write or 0)
        assert.equals(renames_before, store.calls.rename or 0)
    end)

    it("repairs an appmanifest that Steam rewrote", function()
        assert.is_true(lock.lock("440", INFO).ok)
        store.seed(MANIFEST, STEAM_REWRITTEN)
        local result = lock.reapply("440")
        assert.is_true(result.ok)
        local written = store.read(MANIFEST)
        assert.is_not_nil(written:find('"StateFlags"%s+"4"'))
        assert.is_not_nil(written:find('"TargetBuildID"%s+"0"'))
        assert.is_not_nil(written:find('"buildid"%s+"12345678"'))
        assert.is_not_nil(written:find('"7588696787324571854"'))
    end)

    it("rewrites an appmanifest that carries an extra depot", function()
        assert.is_true(lock.lock("440", INFO).ok)
        store.seed(MANIFEST, EXTRA_DEPOT)
        local writes_before = store.calls.write or 0
        local result = lock.reapply("440")
        assert.is_true(result.ok)
        assert.is_true((store.calls.write or 0) > writes_before)
        local written = store.read(MANIFEST)
        assert.is_not_nil(written:find('"buildid"%s+"12345678"'))
        assert.is_not_nil(written:find('"7588696787324571854"'))
    end)

    it("keeps a repair for one app idempotent", function()
        assert.is_true(lock.lock("440", INFO).ok)
        store.seed(MANIFEST, STEAM_REWRITTEN)
        assert.is_true(lock.reapply("440").ok)
        local first = store.read(MANIFEST)
        local writes_before = store.calls.write or 0
        assert.is_true(lock.reapply("440").ok)
        assert.equals(first, store.read(MANIFEST))
        assert.equals(writes_before, store.calls.write or 0)
    end)

    it("serializes a re-entrant repair for one app", function()
        assert.is_true(lock.lock("440", INFO).ok)
        store.seed(MANIFEST, STEAM_REWRITTEN)
        local writes = 0
        local entered = false
        local depth = 0
        store.hook = function(op)
            if op == "write" then
                writes = writes + 1
                depth = depth + 1
                if depth == 1 then
                    entered = true
                    local ok = pcall(lock.reapply, "440")
                    assert.is_true(ok)
                end
                depth = depth - 1
            end
        end
        local result = lock.reapply("440")
        store.hook = nil
        assert.is_true(result.ok)
        assert.is_true(entered)
        assert.is_true(writes <= 2)
        assert.is_not_nil(store.read(MANIFEST):find('"buildid"%s+"12345678"'))
    end)

    it("restores every healthy app and clears the cached dumps", function()
        assert.is_true(lock.lock("440", INFO).ok)
        assert.is_true(lock.lock("570", INFO_570).ok)
        store.seed("/xdg/cache/steamapp-verlock/buildinfo/440.kv", "dump 440")
        store.seed("/xdg/cache/steamapp-verlock/buildinfo/570.kv", "dump 570")
        local result = lock.restore_all()
        assert.is_true(result.ok)
        assert.equals(2, result.restored)
        assert.equals(0, #(result.failed or {}))
        assert.equals(ORIGINAL, store.read(MANIFEST))
        assert.equals(ORIGINAL_570, store.read(MANIFEST_570))
        assert.is_nil(state.read("440"))
        assert.is_nil(state.read("570"))
        assert.is_false(store.exists("/xdg/cache/steamapp-verlock/buildinfo/440.kv"))
        assert.is_false(store.exists("/xdg/cache/steamapp-verlock/buildinfo/570.kv"))
        assert.is_true(store.exists("/xdg/cache/steamapp-verlock/buildinfo"))
    end)

    it("keeps a record whose appmanifest cannot be written", function()
        assert.is_true(lock.lock("440", INFO).ok)
        local locked = store.read(MANIFEST)
        store.fail_ops({ write = true, rename = true }, "permission denied")
        local result = lock.restore_all()
        local failed = false
        for _, appid in ipairs(result.failed or {}) do
            if tostring(appid) == "440" then
                failed = true
            end
        end
        assert.is_true(failed)
        assert.is_not_nil(state.read("440"))
        assert.equals(locked, store.read(MANIFEST))
    end)

    it("drops a record whose app is no longer installed", function()
        assert.is_true(lock.lock("440", INFO).ok)
        store.delete(MANIFEST)
        local result = lock.restore_all()
        assert.is_nil(state.read("440"))
        assert.equals(0, result.restored)
        assert.equals(0, #(result.failed or {}))
    end)

    it("persists the record before writing the spoofed appmanifest", function()
        local record_checked = false
        local record_present = false
        store.hook = function(op, path)
            if op == "write" and path:sub(1, #MANIFEST) == MANIFEST and path:sub(-4) == ".tmp" then
                record_checked = true
                record_present = state.read("440") ~= nil
            end
        end
        local result = lock.lock("440", INFO)
        store.hook = nil
        assert.is_true(result.ok)
        assert.is_true(record_checked)
        assert.is_true(record_present)
    end)

    it("removes the record when the appmanifest write fails", function()
        store.hook = function(op, path)
            if op == "write" and path:sub(1, #MANIFEST) == MANIFEST and path:sub(-4) == ".tmp" then
                store.fail_next("write", "permission denied")
            end
        end
        local result = lock.lock("440", INFO)
        store.hook = nil
        assert.is_false(result.ok)
        assert.is_nil(state.read("440"))
    end)

    it("refuses to lock an app that is already locked", function()
        assert.is_true(lock.lock("440", INFO).ok)
        local spoofed = store.read(MANIFEST)
        local result = lock.lock("440", { buildid = "99999999", depots = { ["441"] = "5" } })
        assert.is_false(result.ok)
        assert.is_string(result.error)
        local record = state.read("440")
        assert.equals(ORIGINAL, record.original)
        assert.equals("12345678", record.locked_build.buildid)
        assert.equals(spoofed, store.read(MANIFEST))
    end)

    it("keeps the record when an unlock write fails", function()
        assert.is_true(lock.lock("440", INFO).ok)
        local locked = store.read(MANIFEST)
        store.fail_ops({ write = true, rename = true }, "permission denied")
        local result = lock.unlock("440")
        assert.is_false(result.ok)
        assert.is_not_nil(state.read("440"))
        assert.equals(locked, store.read(MANIFEST))
    end)

    it("removes the temporary appmanifest when the unlock rename fails", function()
        assert.is_true(lock.lock("440", INFO).ok)
        local temporary
        store.hook = function(op, path)
            if op == "write" and path:sub(1, #MANIFEST) == MANIFEST and path:sub(-4) == ".tmp" then
                temporary = path
            end
        end
        store.fail_next("rename", "rename denied")
        local result = lock.unlock("440")
        store.hook = nil
        assert.is_false(result.ok)
        assert.is_not_nil(state.read("440"))
        assert.is_not_nil(temporary)
        assert.is_false(store.exists(temporary))
    end)

    it("removes the temporary appmanifest when the unlock write fails", function()
        assert.is_true(lock.lock("440", INFO).ok)
        local temporary
        store.hook = function(op, path)
            if op == "write" and path:sub(1, #MANIFEST) == MANIFEST and path:sub(-4) == ".tmp" then
                temporary = path
                store.fail_next("write", "permission denied")
            end
        end
        local result = lock.unlock("440")
        store.hook = nil
        assert.is_false(result.ok)
        assert.is_not_nil(state.read("440"))
        assert.is_not_nil(temporary)
        assert.is_false(store.exists(temporary))
    end)

    it("refuses to restore a record with an empty original", function()
        assert.is_true(lock.lock("440", INFO).ok)
        local record = state.read("440")
        record.original = ""
        store.seed(state.path("440"), require("json").encode(record))
        local locked = store.read(MANIFEST)
        local result = lock.unlock("440")
        assert.is_false(result.ok)
        assert.is_true(store.exists(state.path("440")))
        assert.equals(locked, store.read(MANIFEST))
    end)

    it("does not restore a record with an empty original", function()
        assert.is_true(lock.lock("440", INFO).ok)
        local record = state.read("440")
        record.original = ""
        store.seed(state.path("440"), require("json").encode(record))
        local locked = store.read(MANIFEST)
        local result = lock.restore_all()
        assert.equals(0, result.restored)
        assert.equals(0, #(result.failed or {}))
        assert.equals(locked, store.read(MANIFEST))
    end)

    it("persists the refreshed record before writing the spoofed appmanifest", function()
        assert.is_true(lock.lock("440", INFO).ok)
        support.set_time(2000)
        local record_present = false
        local record_updated = false
        store.hook = function(op, path)
            if op == "write" and path:sub(1, #MANIFEST) == MANIFEST and path:sub(-4) == ".tmp" then
                local current = state.read("440")
                record_present = current ~= nil
                record_updated = current ~= nil and current.locked_build.buildid == "22345678"
            end
        end
        local refreshed = { buildid = "22345678", depots = { ["441"] = "9999999999999999999" } }
        local result = lock.refresh("440", refreshed)
        store.hook = nil
        assert.is_true(result.ok)
        assert.is_true(record_present)
        assert.is_true(record_updated)
    end)

    it("restores the previous record when a refresh appmanifest write fails", function()
        assert.is_true(lock.lock("440", INFO).ok)
        support.set_time(2000)
        store.hook = function(op, path)
            if op == "write" and path:sub(1, #MANIFEST) == MANIFEST and path:sub(-4) == ".tmp" then
                store.fail_next("write", "permission denied")
            end
        end
        local refreshed = { buildid = "22345678", depots = { ["441"] = "9999999999999999999" } }
        local result = lock.refresh("440", refreshed)
        store.hook = nil
        assert.is_false(result.ok)
        local record = state.read("440")
        assert.same(INFO, record.locked_build)
        assert.is_nil(record.refreshed_at)
        assert.is_not_nil(store.read(MANIFEST):find('"buildid"%s+"12345678"'))
    end)

    it("reports not_installed when the appmanifest is gone", function()
        assert.is_true(lock.lock("440", INFO).ok)
        store.delete(MANIFEST)
        local result = lock.reapply("440")
        assert.is_false(result.ok)
        assert.equals("not_installed", result.code)
    end)

    it("does not set a code when the app is not locked", function()
        local result = lock.reapply("440")
        assert.is_false(result.ok)
        assert.is_nil(result.code)
    end)

    it("does not report not_installed when the cached manifest path still exists", function()
        assert.is_true(lock.lock("440", INFO).ok)
        local original_resolve = paths.resolve_manifest
        local original_find = paths.find_appmanifest
        paths.resolve_manifest = function()
            return nil, "transient read failure"
        end
        paths.find_appmanifest = function()
            return nil, "transient discovery failure"
        end
        local result = lock.reapply("440")
        paths.resolve_manifest = original_resolve
        paths.find_appmanifest = original_find
        assert.is_true(result.ok)
        assert.is_nil(result.code)
    end)

    it("does not fall back to a cached path with a mismatched filename", function()
        assert.is_true(lock.lock("440", INFO).ok)
        local record = state.read("440")
        record.manifest_path = MANIFEST_570
        state.write(record)
        local original_resolve = paths.resolve_manifest
        local original_find = paths.find_appmanifest
        paths.resolve_manifest = function()
            return nil, "transient read failure"
        end
        paths.find_appmanifest = function()
            return nil, "transient discovery failure"
        end
        local result = lock.reapply("440")
        paths.resolve_manifest = original_resolve
        paths.find_appmanifest = original_find
        assert.is_false(result.ok)
        assert.equals("not_installed", result.code)
    end)

    it("does not fall back to a cached path whose appid does not match", function()
        assert.is_true(lock.lock("440", INFO).ok)
        store.seed(MANIFEST, (ORIGINAL:gsub('"appid"%s+"440"', '"appid"\t\t"570"')))
        local original_resolve = paths.resolve_manifest
        local original_find = paths.find_appmanifest
        paths.resolve_manifest = function()
            return nil, "transient read failure"
        end
        paths.find_appmanifest = function()
            return nil, "transient discovery failure"
        end
        local result = lock.reapply("440")
        paths.resolve_manifest = original_resolve
        paths.find_appmanifest = original_find
        assert.is_false(result.ok)
        assert.equals("not_installed", result.code)
    end)

    it("re-applies when discovery finds the manifest on retry", function()
        assert.is_true(lock.lock("440", INFO).ok)
        store.seed(MANIFEST, STEAM_REWRITTEN)
        local original_resolve = paths.resolve_manifest
        paths.resolve_manifest = function()
            return nil, "transient discovery failure"
        end
        local result = lock.reapply("440")
        paths.resolve_manifest = original_resolve
        assert.is_true(result.ok)
        assert.is_nil(result.code)
        assert.is_not_nil(store.read(MANIFEST):find('"buildid"%s+"12345678"'))
    end)

    it("returns an error without a code when discovery cannot run", function()
        assert.is_true(lock.lock("440", INFO).ok)
        store.delete(MANIFEST)
        support.hide_env("MILLENNIUM__STEAM_PATH")
        local result = lock.reapply("440")
        support.set_env("MILLENNIUM__STEAM_PATH", "/steam")
        assert.is_false(result.ok)
        assert.is_nil(result.code)
        assert.is_string(result.error)
    end)

    it("stores the auto update behavior and returns it on unlock", function()
        local result = lock.lock("440", INFO, 2)
        assert.is_true(result.ok)
        assert.equals(2, state.read("440").auto_update_behavior)
        local unlocked = lock.unlock("440")
        assert.is_true(unlocked.ok)
        assert.equals(2, unlocked.auto_update_behavior)
        assert.is_nil(state.read("440"))
    end)

    it("carries the auto update behavior when an orphaned record is unlocked", function()
        assert.is_true(lock.lock("440", INFO, 2).ok)
        store.delete(MANIFEST)
        local unlocked = lock.unlock("440")
        assert.is_true(unlocked.ok)
        assert.equals(2, unlocked.auto_update_behavior)
        assert.is_nil(state.read("440"))
    end)

    it("restores the auto update behaviors during restore all", function()
        assert.is_true(lock.lock("440", INFO, 0).ok)
        assert.is_true(lock.lock("570", INFO_570, 1).ok)
        local result = lock.restore_all()
        assert.is_true(result.ok)
        assert.equals(2, result.restored)
        local found = {}
        for _, entry in ipairs(result.auto_update or {}) do
            found[tostring(entry.appid)] = entry.behavior
        end
        assert.equals(0, found["440"])
        assert.equals(1, found["570"])
    end)

    it("refuses to lock an app that is not fully installed", function()
        store.seed(MANIFEST, (ORIGINAL:gsub('"StateFlags"\t\t"4"', '"StateFlags"\t\t"1026"')))
        local result = lock.lock("440", INFO)
        assert.is_false(result.ok)
        assert.is_nil(state.read("440"))
    end)

    it("refuses to lock an app with a pending update", function()
        store.seed(MANIFEST, (ORIGINAL:gsub('"StateFlags"\t\t"4"', '"StateFlags"\t\t"6"')))
        local result = lock.lock("440", INFO)
        assert.is_false(result.ok)
        assert.is_nil(state.read("440"))
    end)

    it("keeps the record when unlock discovery cannot run", function()
        assert.is_true(lock.lock("440", INFO).ok)
        store.delete(MANIFEST)
        support.hide_env("MILLENNIUM__STEAM_PATH")
        local result = lock.unlock("440")
        support.set_env("MILLENNIUM__STEAM_PATH", "/steam")
        assert.is_false(result.ok)
        assert.is_string(result.error)
        assert.is_not_nil(state.read("440"))
    end)

    it("rejects a concurrent write for the same app", function()
        local nested
        store.hook = function(op, path)
            if op == "write" and path:sub(1, #MANIFEST) == MANIFEST and path:sub(-4) == ".tmp" then
                nested = lock.lock("440", { buildid = "99999999", depots = { ["441"] = "5" } })
            end
        end
        local result = lock.lock("440", INFO)
        store.hook = nil
        assert.is_true(result.ok)
        assert.is_false(nested.ok)
        assert.is_string(nested.error)
    end)

    it("aborts a reapply when the record disappears before the write", function()
        assert.is_true(lock.lock("440", INFO).ok)
        store.seed(MANIFEST, STEAM_REWRITTEN)
        local removed = false
        store.hook = function(op, path)
            if op == "read" and path == MANIFEST and not removed then
                removed = true
                store.delete(state.path("440"))
            end
        end
        local result = lock.reapply("440")
        store.hook = nil
        assert.is_false(result.ok)
        assert.equals(STEAM_REWRITTEN, store.read(MANIFEST))
    end)

    it("does not clear buildinfo while a migration runs", function()
        assert.is_true(lock.lock("440", INFO).ok)
        store.seed("/xdg/cache/steamapp-verlock/buildinfo/440.kv", "dump")
        state.set_migrating(true)
        local result = lock.restore_all()
        state.set_migrating(false)
        assert.is_false(result.ok)
        assert.is_true(store.exists("/xdg/cache/steamapp-verlock/buildinfo/440.kv"))
        assert.is_not_nil(state.read("440"))
    end)
end)
