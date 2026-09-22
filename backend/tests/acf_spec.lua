local support = require("support")

describe("acf", function()
    local acf
    local store

    local function body(state)
        return state.AppState or state
    end

    before_each(function()
        support.reset()
        support.install_json()
        store = support.use_fake_fs()
        support.stub_logger()
        support.stub_millennium()
        acf = support.require_fresh("acf")
    end)

    after_each(function()
        support.cleanup()
    end)

    it("reads an appmanifest into a table", function()
        local path = store.seed("/steam/steamapps/appmanifest_440.acf", support.read_fixture("appmanifest_440.acf"))
        local state, err = acf.read(path)
        assert.is_nil(err)
        assert.is_not_nil(state)
        assert.equals("440", body(state).appid)
        assert.equals("12345678", body(state).buildid)
        assert.equals("7588696787324571854", body(state).InstalledDepots["441"].manifest)
    end)

    it("returns an error for a missing appmanifest", function()
        local state, err, code = acf.read("/steam/steamapps/appmanifest_999.acf")
        assert.is_nil(state)
        assert.is_string(err)
        assert.equals("cannot_read_manifest", code)
    end)

    it("sets one field on the appmanifest table", function()
        local path = store.seed("/steam/steamapps/appmanifest_440.acf", support.read_fixture("appmanifest_440.acf"))
        local state = acf.read(path)
        acf.set(state, "StateFlags", "7")
        acf.set(state, "TargetBuildID", "0")
        assert.equals("7", body(state).StateFlags)
        assert.equals("0", body(state).TargetBuildID)
    end)

    it("writes through a temporary file and a rename", function()
        local path = store.seed("/steam/steamapps/appmanifest_440.acf", support.read_fixture("appmanifest_440.acf"))
        local state = acf.read(path)
        acf.set(state, "StateFlags", "7")
        local renames_before = store.calls.rename or 0
        local ok, err = acf.write(path, state)
        assert.is_true(ok)
        assert.is_nil(err)
        assert.is_true((store.calls.rename or 0) > renames_before)
        local written = store.read(path)
        assert.is_not_nil(written:find('"StateFlags"%s+"7"'))
    end)

    it("leaves the previous file intact when the write fails", function()
        local path = store.seed("/steam/steamapps/appmanifest_440.acf", support.read_fixture("appmanifest_440.acf"))
        local state = acf.read(path)
        acf.set(state, "StateFlags", "7")
        assert.is_true(acf.write(path, state))
        local previous = store.read(path)
        acf.set(state, "StateFlags", "8")
        store.fail_next("write", "disk full")
        local ok, err, code = acf.write(path, state)
        assert.is_false(ok)
        assert.is_string(err)
        assert.equals("manifest_write_failed", code)
        assert.equals(previous, store.read(path))
    end)

    it("uses a distinct temporary name for every write", function()
        local path = store.seed("/steam/steamapps/appmanifest_440.acf", support.read_fixture("appmanifest_440.acf"))
        local state = acf.read(path)
        local counter = 0
        store.utils.uuid = function()
            counter = counter + 1
            return "unique" .. counter
        end
        local temporary = {}
        store.hook = function(op, written_path)
            if op == "write" then
                table.insert(temporary, written_path)
            end
        end
        assert.is_true(acf.write(path, state))
        local first = temporary[#temporary]
        assert.is_true(acf.write(path, state))
        local second = temporary[#temporary]
        store.hook = nil
        assert.is_not_equal(first, second)
        assert.is_false(store.exists(first))
        assert.is_false(store.exists(second))
    end)

    it("removes the temporary file when the write fails", function()
        local path = store.seed("/steam/steamapps/appmanifest_440.acf", support.read_fixture("appmanifest_440.acf"))
        local state = acf.read(path)
        local temporary
        store.hook = function(op, written_path)
            if op == "write" then
                temporary = written_path
                store.fail_next("write", "disk full")
            end
        end
        local ok, err = acf.write(path, state)
        store.hook = nil
        assert.is_false(ok)
        assert.is_string(err)
        assert.is_not_nil(temporary)
        assert.is_false(store.exists(temporary))
    end)

    it("leaves the previous file intact when the rename fails", function()
        local path = store.seed("/steam/steamapps/appmanifest_440.acf", support.read_fixture("appmanifest_440.acf"))
        local state = acf.read(path)
        acf.set(state, "StateFlags", "7")
        local previous = store.read(path)
        store.fail_next("rename", "rename denied")
        local ok, err = acf.write(path, state)
        assert.is_false(ok)
        assert.is_string(err)
        assert.equals(previous, store.read(path))
    end)

    it("removes the temporary file when the rename fails", function()
        local path = store.seed("/steam/steamapps/appmanifest_440.acf", support.read_fixture("appmanifest_440.acf"))
        local state = acf.read(path)
        local temporary
        store.hook = function(op, written_path)
            if op == "write" then
                temporary = written_path
            end
        end
        store.fail_next("rename", "rename denied")
        local ok, err = acf.write(path, state)
        store.hook = nil
        assert.is_false(ok)
        assert.is_string(err)
        assert.is_not_nil(temporary)
        assert.is_false(store.exists(temporary))
    end)
end)
