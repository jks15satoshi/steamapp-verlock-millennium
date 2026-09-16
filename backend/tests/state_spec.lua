local support = require("support")

describe("state", function()
    local state
    local store

    local function record_for(appid, overrides)
        local options = {
            manifest_path = "/steam/steamapps/appmanifest_" .. appid .. ".acf",
            locked_build = { buildid = "12345678", depots = { ["441"] = "7588696787324571854" } },
            original = '"AppState"\n{\n\t"appid"\t\t"' .. appid .. '"\n}\n',
        }
        for key, value in pairs(overrides or {}) do
            options[key] = value
        end
        return support.record(appid, options)
    end

    before_each(function()
        support.reset()
        support.install_json()
        store = support.use_fake_fs()
        support.stub_logger()
        support.stub_millennium({ config = { data_root = "/data" } })
        state = support.require_fresh("state")
    end)

    after_each(function()
        support.cleanup()
    end)

    it("returns the record file path for an appid", function()
        assert.equals("/data/locks/440.lock", state.path("440"))
    end)

    it("writes and reads one record", function()
        local record = record_for("440")
        local ok, err = state.write(record)
        assert.is_true(ok)
        assert.is_nil(err)
        local loaded, read_err = state.read("440")
        assert.is_nil(read_err)
        assert.is_not_nil(loaded)
        assert.equals("440", loaded.appid)
        assert.equals(record.manifest_path, loaded.manifest_path)
        assert.same(record.locked_build, loaded.locked_build)
        assert.equals(record.original, loaded.original)
    end)

    it("writes through a temporary file and a rename", function()
        local record = record_for("440")
        local temporary
        store.hook = function(op, path)
            if op == "write" then
                temporary = path
            end
        end
        assert.is_true(state.write(record))
        store.hook = nil
        assert.is_not_nil(temporary)
        assert.is_true(temporary ~= state.path("440"))
        assert.equals(".tmp", temporary:sub(-4))
        assert.is_false(store.exists(temporary))
        local renames_before = store.calls.rename or 0
        record.name = "Renamed"
        assert.is_true(state.write(record))
        assert.is_true((store.calls.rename or 0) > renames_before)
        assert.equals("Renamed", state.read("440").name)
    end)

    it("uses a distinct temporary name for every write", function()
        local counter = 0
        store.utils.uuid = function()
            counter = counter + 1
            return "unique" .. counter
        end
        local temporary = {}
        store.hook = function(op, path)
            if op == "write" then
                table.insert(temporary, path)
            end
        end
        local record = record_for("440")
        assert.is_true(state.write(record))
        local first = temporary[#temporary]
        record.name = "Again"
        assert.is_true(state.write(record))
        local second = temporary[#temporary]
        store.hook = nil
        assert.is_not_equal(first, second)
    end)

    it("returns false and leaves the record intact when the write fails", function()
        local record = record_for("440")
        assert.is_true(state.write(record))
        local previous = store.read(state.path("440"))
        record.name = "Changed"
        store.fail_next("write", "disk full")
        local ok, err = state.write(record)
        assert.is_false(ok)
        assert.is_string(err)
        assert.equals(previous, store.read(state.path("440")))
    end)

    it("lists every record", function()
        assert.is_true(state.write(record_for("440")))
        assert.is_true(state.write(record_for("570")))
        local records = state.list()
        assert.equals(2, #records)
        local appids = {}
        for _, record in ipairs(records) do
            appids[tostring(record.appid)] = true
        end
        assert.is_true(appids["440"])
        assert.is_true(appids["570"])
    end)

    it("removes one record", function()
        assert.is_true(state.write(record_for("440")))
        state.remove("440")
        assert.is_nil(state.read("440"))
    end)

    it("returns nil for a missing record", function()
        local loaded = state.read("999")
        assert.is_nil(loaded)
    end)

    it("refuses a record whose version is not 1", function()
        local json = require("json")
        local record = record_for("440")
        record.version = 2
        store.seed(state.path("440"), json.encode(record))
        local loaded, err = state.read("440")
        assert.is_nil(loaded)
        assert.is_string(err)
    end)

    it("refuses a record that omits a required field", function()
        local json = require("json")
        local record = record_for("440")
        record.name = nil
        store.seed(state.path("440"), json.encode(record))
        local loaded, err = state.read("440")
        assert.is_nil(loaded)
        assert.is_string(err)
    end)

    it("refuses a record with an empty original", function()
        local json = require("json")
        local record = record_for("440")
        record.original = ""
        store.seed(state.path("440"), json.encode(record))
        local loaded, err = state.read("440")
        assert.is_nil(loaded)
        assert.is_string(err)
    end)

    it("skips an invalid record when listing", function()
        local json = require("json")
        assert.is_true(state.write(record_for("440")))
        local invalid = record_for("570")
        invalid.original = ""
        store.seed(state.path("570"), json.encode(invalid))
        local records = state.list()
        assert.equals(1, #records)
        assert.equals("440", records[1].appid)
    end)

    it("writes and reads the optional auto update behavior", function()
        local record = record_for("440", { auto_update_behavior = 2 })
        assert.is_true(state.write(record))
        local loaded = state.read("440")
        assert.equals(2, loaded.auto_update_behavior)
    end)

    it("refuses a record with a non-numeric auto update behavior", function()
        local json = require("json")
        local record = record_for("440", { auto_update_behavior = "always" })
        store.seed(state.path("440"), json.encode(record))
        local loaded, err = state.read("440")
        assert.is_nil(loaded)
        assert.is_string(err)
    end)

    it("returns an error from list while a migration runs", function()
        assert.is_true(state.write(record_for("440")))
        state.set_migrating(true)
        local records, err = state.list()
        state.set_migrating(false)
        assert.is_nil(records)
        assert.is_string(err)
    end)
end)
