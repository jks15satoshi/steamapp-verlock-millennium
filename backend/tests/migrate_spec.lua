local support = require("support")

describe("migrate", function()
    local migrate
    local store
    local json

    local function seed_lock(appid)
        local record = support.record(appid, {
            manifest_path = "/steam/steamapps/appmanifest_" .. appid .. ".acf",
            original = '"AppState"\n{\n\t"appid"\t\t"' .. appid .. '"\n}\n',
        })
        store.seed("/old/data/locks/" .. appid .. ".lock", json.encode(record))
    end

    before_each(function()
        support.reset()
        support.install_json()
        json = require("json")
        store = support.use_fake_fs()
        support.stub_logger()
        support.stub_millennium({ config = { data_root = "/old/data" } })
        migrate = support.require_fresh("migrate")
    end)

    after_each(function()
        support.cleanup()
    end)

    it("copies, verifies, persists, and deletes the old root", function()
        seed_lock("440")
        local result = migrate.move("/old/data", "/new/data")
        assert.is_true(result.ok)
        assert.equals("/new/data", result.data_root)
        assert.is_true(store.exists("/new/data/locks/440.lock"))
        assert.is_false(store.exists("/old/data/locks/440.lock"))
        assert.equals("/new/data", support.millennium.config_values.data_root)
    end)

    it("keeps the old root and removes the partial copy when a copy fails", function()
        seed_lock("440")
        seed_lock("570")
        store.fail_ops({ copy = true, copy_recursive = true }, "io error")
        local result = migrate.move("/old/data", "/new/data")
        assert.is_true(support.is_failure(result.ok))
        assert.equals("migration_failed", result.code)
        assert.is_true(store.exists("/old/data/locks/440.lock"))
        assert.is_true(store.exists("/old/data/locks/570.lock"))
        assert.is_false(store.exists("/new/data/locks/440.lock"))
        assert.equals("/old/data", support.millennium.config_values.data_root)
    end)

    it("keeps the old root when a copied record fails verification", function()
        seed_lock("440")
        store.seed("/old/data/locks/bad.lock", "{ this is not valid json")
        local result = migrate.move("/old/data", "/new/data")
        assert.is_true(support.is_failure(result.ok))
        assert.is_true(store.exists("/old/data/locks/440.lock"))
        assert.is_true(store.exists("/old/data/locks/bad.lock"))
        assert.equals("/old/data", support.millennium.config_values.data_root)
    end)

    it("keeps the old root when a copied record omits its name", function()
        seed_lock("440")
        local record = support.record("570")
        record.name = nil
        store.seed("/old/data/locks/570.lock", json.encode(record))
        local result = migrate.move("/old/data", "/new/data")
        assert.is_true(support.is_failure(result.ok))
        assert.is_true(store.exists("/old/data/locks/570.lock"))
        assert.equals("/old/data", support.millennium.config_values.data_root)
    end)

    it("keeps the old root when a copied record omits its lock time", function()
        seed_lock("440")
        local record = support.record("570")
        record.locked_at = nil
        store.seed("/old/data/locks/570.lock", json.encode(record))
        local result = migrate.move("/old/data", "/new/data")
        assert.is_true(support.is_failure(result.ok))
        assert.is_true(store.exists("/old/data/locks/570.lock"))
        assert.equals("/old/data", support.millennium.config_values.data_root)
    end)

    it("keeps the old root and removes the partial copy when the config write fails", function()
        seed_lock("440")
        support.millennium.config.set = function()
            return false, "config denied"
        end
        local result = migrate.move("/old/data", "/new/data")
        assert.is_true(support.is_failure(result.ok))
        assert.equals("config denied", result.error)
        assert.equals("migration_failed", result.code)
        assert.is_true(store.exists("/old/data/locks/440.lock"))
        assert.is_false(store.exists("/new/data/locks/440.lock"))
    end)

    it("reports a warning when the old root cannot be removed", function()
        seed_lock("440")
        store.fail_next("remove_all", "cannot remove")
        local result = migrate.move("/old/data", "/new/data")
        assert.is_true(result.ok)
        assert.is_string(result.warning)
        assert.is_true(store.exists("/new/data/locks/440.lock"))
        assert.is_true(store.exists("/old/data/locks/440.lock"))
    end)
end)
