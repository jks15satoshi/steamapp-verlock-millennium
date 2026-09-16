local support = require("support")

describe("integration", function()
    local store
    local lock
    local state
    local paths
    local migrate

    local tmp
    local steam
    local library
    local cache
    local data
    local manifest
    local manifest_570

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

    local INFO = { buildid = "12345678", depots = { ["441"] = "7588696787324571854" } }
    local INFO_570 = {
        buildid = "20000000",
        depots = {
            ["570"] = "1111111111111111111",
            ["571"] = "2222222222222222222",
            ["580"] = "3333333333333333333",
        },
    }

    local function libraryfolders()
        return table.concat({
            '"libraryfolders"',
            "{",
            '\t"0"',
            "\t{",
            '\t\t"path"\t\t"' .. steam .. '"',
            "\t}",
            '\t"1"',
            "\t{",
            '\t\t"path"\t\t"' .. library .. '"',
            "\t}",
            "}",
            "",
        }, "\n")
    end

    local function steamapps()
        return steam .. "/steamapps"
    end

    local function library_apps()
        return library .. "/steamapps"
    end

    local function cache_buildinfo()
        return cache .. "/steamapp-verlock/buildinfo"
    end

    before_each(function()
        support.reset()
        support.install_json()
        store = support.use_real_fs()
        support.stub_logger()
        tmp = support.tmpdir()
        steam = tmp .. "/steam"
        library = tmp .. "/library"
        cache = tmp .. "/cache"
        data = tmp .. "/data"
        manifest = steamapps() .. "/appmanifest_440.acf"
        manifest_570 = steamapps() .. "/appmanifest_570.acf"
        store.seed_directory(steamapps())
        store.seed_directory(library_apps())
        store.seed_directory(steam .. "/config")
        store.seed(steamapps() .. "/libraryfolders.vdf", libraryfolders())
        store.seed(manifest, ORIGINAL)
        store.seed(manifest_570, ORIGINAL_570)
        support.stub_millennium({ config = { data_root = data } })
        support.set_env("MILLENNIUM__STEAM_PATH", steam)
        support.set_env("XDG_DATA_HOME", tmp .. "/xdg-data")
        support.set_env("XDG_CACHE_HOME", cache)
        support.set_time(1000)
        local modules = support.load("lock", "state", "paths", "migrate")
        lock = modules.lock
        state = modules.state
        paths = modules.paths
        migrate = modules.migrate
    end)

    after_each(function()
        support.cleanup()
    end)

    it("locks an app and stores the verbatim original", function()
        local result = lock.lock("440", INFO)
        assert.is_true(result.ok)
        local written = store.read(manifest)
        assert.is_not_nil(written:find('"StateFlags"%s+"4"'))
        assert.is_not_nil(written:find('"TargetBuildID"%s+"0"'))
        assert.is_not_nil(written:find('"buildid"%s+"12345678"'))
        assert.is_not_nil(written:find('"7588696787324571854"'))
        local record = state.read("440")
        assert.equals(ORIGINAL, record.original)
        assert.same(INFO, record.locked_build)
    end)

    it("refreshes the locked build and timestamp", function()
        assert.is_true(lock.lock("440", INFO).ok)
        support.set_time(2000)
        local refreshed = { buildid = "22345678", depots = { ["441"] = "9999999999999999999" } }
        assert.is_true(lock.refresh("440", refreshed).ok)
        local record = state.read("440")
        assert.equals("22345678", record.locked_build.buildid)
        assert.equals("9999999999999999999", record.locked_build.depots["441"])
        assert.equals(2000, record.refreshed_at)
        assert.is_not_nil(store.read(manifest):find('"buildid"%s+"22345678"'))
    end)

    it("refuses to lock an app that is already locked", function()
        assert.is_true(lock.lock("440", INFO).ok)
        local result = lock.lock("440", INFO)
        assert.is_true(support.is_failure(result.ok))
        assert.equals(ORIGINAL, state.read("440").original)
    end)

    it("restores the previous record when a refresh appmanifest write fails", function()
        assert.is_true(lock.lock("440", INFO).ok)
        support.set_time(2000)
        store.hook = function(op, path)
            if op == "write" and path:sub(1, #manifest) == manifest and path:sub(-4) == ".tmp" then
                store.fail_next("write", "permission denied")
            end
        end
        local refreshed = { buildid = "22345678", depots = { ["441"] = "9999999999999999999" } }
        local result = lock.refresh("440", refreshed)
        store.hook = nil
        assert.is_true(support.is_failure(result.ok))
        local record = state.read("440")
        assert.same(INFO, record.locked_build)
        assert.is_nil(record.refreshed_at)
        assert.is_not_nil(store.read(manifest):find('"buildid"%s+"12345678"'))
    end)

    it("unlocks and restores the original appmanifest", function()
        assert.is_true(lock.lock("440", INFO).ok)
        assert.is_true(lock.unlock("440").ok)
        assert.equals(ORIGINAL, store.read(manifest))
        assert.is_nil(state.read("440"))
    end)

    it("repairs an appmanifest that Steam rewrote", function()
        assert.is_true(lock.lock("440", INFO).ok)
        store.seed(
            manifest,
            table.concat({
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
        )
        assert.is_true(lock.reapply("440").ok)
        local written = store.read(manifest)
        assert.is_not_nil(written:find('"StateFlags"%s+"4"'))
        assert.is_not_nil(written:find('"buildid"%s+"12345678"'))
    end)

    it("discovers the appmanifest after the install directory moves", function()
        assert.is_true(lock.lock("440", INFO).ok)
        local moved = library_apps() .. "/appmanifest_440.acf"
        store.seed(moved, ORIGINAL)
        store.delete(manifest)
        local found, err = paths.find_appmanifest("440")
        assert.is_nil(err)
        assert.equals(moved, found)
        local refreshed = { buildid = "12345678", depots = { ["441"] = "7588696787324571854" } }
        assert.is_true(lock.refresh("440", refreshed).ok)
        assert.equals(moved, state.read("440").manifest_path)
        assert.is_not_nil(store.read(moved):find('"buildid"%s+"12345678"'))
    end)

    it("rolls the data root migration back on failure", function()
        assert.is_true(lock.lock("440", INFO).ok)
        local target = tmp .. "/data-moved"
        store.fail_ops({ copy = true, copy_recursive = true, write = true }, "io error")
        local result = migrate.move(data, target)
        assert.is_true(support.is_failure(result.ok))
        assert.is_true(store.exists(data .. "/locks/440.lock"))
        assert.is_false(store.exists(target .. "/locks/440.lock"))
    end)

    it("restores healthy apps and clears buildinfo while keeping the directory", function()
        assert.is_true(lock.lock("440", INFO).ok)
        assert.is_true(lock.lock("570", INFO_570).ok)
        store.seed(cache_buildinfo() .. "/440.kv", "dump 440")
        store.seed(cache_buildinfo() .. "/570.kv", "dump 570")
        local result = lock.restore_all()
        assert.is_true(result.ok)
        assert.equals(2, result.restored)
        assert.equals(0, #(result.failed or {}))
        assert.equals(ORIGINAL, store.read(manifest))
        assert.equals(ORIGINAL_570, store.read(manifest_570))
        assert.is_nil(state.read("440"))
        assert.is_nil(state.read("570"))
        assert.is_false(store.exists(cache_buildinfo() .. "/440.kv"))
        assert.is_false(store.exists(cache_buildinfo() .. "/570.kv"))
        assert.is_true(store.exists(cache_buildinfo()))
    end)

    it("keeps failed records and drops uninstalled records", function()
        assert.is_true(lock.lock("440", INFO).ok)
        assert.is_true(lock.lock("570", INFO_570).ok)
        store.delete(manifest_570)
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
        assert.is_nil(state.read("570"))
    end)
end)
