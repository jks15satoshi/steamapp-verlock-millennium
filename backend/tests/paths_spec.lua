local support = require("support")

describe("paths", function()
    local store

    local function strip(path)
        return (tostring(path):gsub("/+$", ""))
    end

    local function load_paths()
        return support.require_fresh("paths")
    end

    before_each(function()
        support.reset()
        support.install_json()
        store = support.use_fake_fs()
        support.stub_logger()
        support.stub_millennium()
    end)

    after_each(function()
        support.cleanup()
    end)

    describe("defaults", function()
        it("returns the conventional data directory", function()
            local base
            if support.is_windows then
                base = support.host("/base")
                support.set_env("LOCALAPPDATA", base)
                support.hide_env("XDG_DATA_HOME")
            else
                base = "/base"
                support.set_env("XDG_DATA_HOME", base)
            end
            support.hide_env("HOME")
            local paths = load_paths()
            local roots = paths.defaults()
            assert.equals(base .. "/steamapp-verlock", strip(roots.data_root))
        end)
    end)

    describe("resolve", function()
        it("reports the default root as default", function()
            support.set_env("XDG_DATA_HOME", "/xdg/data")
            support.set_env("XDG_CACHE_HOME", "/xdg/cache")
            local paths = load_paths()
            local roots = paths.resolve()
            assert.equals(strip(paths.defaults().data_root), strip(roots.data_root))
            assert.is_true(roots.is_default)
        end)

        it("prefers a configured data_root", function()
            support.set_env("XDG_DATA_HOME", "/xdg/data")
            support.set_env("XDG_CACHE_HOME", "/xdg/cache")
            support.stub_millennium({ config = { data_root = "/custom/verlock" } })
            local paths = load_paths()
            local roots = paths.resolve()
            assert.equals("/custom/verlock", strip(roots.data_root))
            assert.is_false(roots.is_default)
        end)

        it("falls back to MILLENNIUM__CONFIG_PATH", function()
            support.hide_env("XDG_DATA_HOME")
            support.hide_env("XDG_CACHE_HOME")
            support.hide_env("HOME")
            support.hide_env("LOCALAPPDATA")
            local config = support.host("/cfg")
            support.set_env("MILLENNIUM__CONFIG_PATH", config)
            local paths = load_paths()
            local roots = paths.resolve()
            assert.equals(config .. "/steamapp-verlock", strip(roots.data_root))
        end)
    end)

    describe("validate", function()
        before_each(function()
            support.hide_env("XDG_DATA_HOME")
            support.hide_env("XDG_CACHE_HOME")
            if support.is_windows then
                support.set_env("LOCALAPPDATA", support.host("/home/tester"))
            else
                support.set_env("HOME", "/home/tester")
            end
        end)

        it("accepts a distinct absolute path", function()
            local paths = load_paths()
            local ok, err = paths.validate(support.host("/mnt/verlock-data"))
            assert.is_true(ok)
            assert.is_nil(err)
        end)

        it("rejects a relative path", function()
            local paths = load_paths()
            local ok, err, code = paths.validate("verlock-data")
            assert.is_true(support.is_failure(ok))
            assert.is_string(err)
            assert.equals("data_root_invalid", code)
        end)

        it("rejects the current root itself", function()
            local paths = load_paths()
            local ok = paths.validate(paths.resolve().data_root)
            assert.is_true(support.is_failure(ok))
        end)

        it("rejects a path nested inside the current root", function()
            local paths = load_paths()
            local ok = paths.validate(paths.resolve().data_root .. "/nested")
            assert.is_true(support.is_failure(ok))
        end)

        it("rejects a path that contains the current root", function()
            local paths = load_paths()
            local ok = paths.validate(support.host("/home/tester"))
            assert.is_true(support.is_failure(ok))
        end)

        it("rejects a path that cannot be created or written", function()
            local paths = load_paths()
            store.fail_ops({ create_directories = true, create_directory = true, write = true }, "permission denied")
            local ok, err, code = paths.validate(support.host("/mnt/locked"))
            assert.is_true(support.is_failure(ok))
            assert.is_string(err)
            assert.equals("data_root_invalid", code)
        end)
    end)

    describe("find_appmanifest", function()
        before_each(function()
            support.set_env("MILLENNIUM__STEAM_PATH", "/steam")
            support.set_env("XDG_DATA_HOME", "/xdg/data")
            store.seed_directory("/steam/steamapps")
            store.seed_directory("/steam/config")
            store.seed("/steam/steamapps/libraryfolders.vdf", support.read_fixture("libraryfolders.vdf"))
        end)

        it("finds an appmanifest in a library listed by steamapps/libraryfolders.vdf", function()
            local paths = load_paths()
            store.seed("/library2/steamapps/appmanifest_440.acf", support.read_fixture("appmanifest_440.acf"))
            local found, err = paths.find_appmanifest("440")
            assert.is_nil(err)
            assert.equals("/library2/steamapps/appmanifest_440.acf", found)
        end)

        it("finds an appmanifest in the Steam root", function()
            local paths = load_paths()
            store.seed("/steam/steamapps/appmanifest_570.acf", support.read_fixture("appmanifest_570.acf"))
            local found, err = paths.find_appmanifest("570")
            assert.is_nil(err)
            assert.equals("/steam/steamapps/appmanifest_570.acf", found)
        end)

        it("finds an appmanifest in a library listed by config/libraryfolders.vdf", function()
            local paths = load_paths()
            store.seed(
                "/steam/config/libraryfolders.vdf",
                table.concat({
                    '"libraryfolders"',
                    "{",
                    '\t"0"',
                    "\t{",
                    '\t\t"path"\t\t"/library3"',
                    "\t}",
                    "}",
                    "",
                }, "\n")
            )
            store.seed("/library3/steamapps/appmanifest_999.acf", support.read_fixture("appmanifest_570.acf"))
            local found, err = paths.find_appmanifest("999")
            assert.is_nil(err)
            assert.equals("/library3/steamapps/appmanifest_999.acf", found)
        end)

        it("accepts the libraryfolders root key in any casing", function()
            local paths = load_paths()
            store.seed(
                "/steam/steamapps/libraryfolders.vdf",
                table.concat({
                    '"LibraryFolders"',
                    "{",
                    '\t"0"',
                    "\t{",
                    '\t\t"path"\t\t"/library4"',
                    "\t}",
                    "}",
                    "",
                }, "\n")
            )
            store.seed("/library4/steamapps/appmanifest_730.acf", support.read_fixture("appmanifest_440.acf"))
            local found, err = paths.find_appmanifest("730")
            assert.is_nil(err)
            assert.equals("/library4/steamapps/appmanifest_730.acf", found)
        end)

        it("returns the lexicographically first candidate deterministically", function()
            local paths = load_paths()
            store.seed("/library2/steamapps/appmanifest_440.acf", support.read_fixture("appmanifest_440.acf"))
            store.seed("/library1/steamapps/appmanifest_440.acf", support.read_fixture("appmanifest_440.acf"))
            local found, err = paths.find_appmanifest("440")
            assert.is_nil(err)
            assert.equals("/library1/steamapps/appmanifest_440.acf", found)
        end)

        it("returns an error when the appmanifest is nowhere", function()
            local paths = load_paths()
            local found, err, code = paths.find_appmanifest("123")
            assert.is_nil(found)
            assert.is_string(err)
            assert.equals("not_installed", code)
        end)

        it("returns steam_path_unavailable when the Steam path is absent", function()
            local paths = load_paths()
            support.hide_env("MILLENNIUM__STEAM_PATH")
            local found, err, code = paths.find_appmanifest("123")
            assert.is_nil(found)
            assert.is_string(err)
            assert.equals("steam_path_unavailable", code)
        end)

        it("accepts a legacy string-valued library entry", function()
            local paths = load_paths()
            store.seed(
                "/steam/steamapps/libraryfolders.vdf",
                table.concat({
                    '"libraryfolders"',
                    "{",
                    '\t"1"\t\t"/library5"',
                    "}",
                    "",
                }, "\n")
            )
            store.seed("/library5/steamapps/appmanifest_880.acf", support.read_fixture("appmanifest_440.acf"))
            local found, err = paths.find_appmanifest("880")
            assert.is_nil(err)
            assert.equals("/library5/steamapps/appmanifest_880.acf", found)
        end)
    end)

    describe("resolve_manifest", function()
        before_each(function()
            support.set_env("MILLENNIUM__STEAM_PATH", "/steam")
            support.set_env("XDG_DATA_HOME", "/xdg/data")
            store.seed_directory("/steam/steamapps")
            store.seed("/steam/steamapps/libraryfolders.vdf", support.read_fixture("libraryfolders.vdf"))
        end)

        it("returns a cached path that still names the appmanifest", function()
            local paths = load_paths()
            store.seed("/steam/steamapps/appmanifest_440.acf", support.read_fixture("appmanifest_440.acf"))
            local resolved, err = paths.resolve_manifest("440", "/steam/steamapps/appmanifest_440.acf")
            assert.is_nil(err)
            assert.equals("/steam/steamapps/appmanifest_440.acf", resolved)
        end)

        it("falls back to discovery when the cached path is stale", function()
            local paths = load_paths()
            store.seed("/steam/steamapps/appmanifest_440.acf", support.read_fixture("appmanifest_440.acf"))
            local resolved, err = paths.resolve_manifest("440", "/library2/steamapps/appmanifest_440.acf")
            assert.is_nil(err)
            assert.equals("/steam/steamapps/appmanifest_440.acf", resolved)
        end)
    end)
end)
