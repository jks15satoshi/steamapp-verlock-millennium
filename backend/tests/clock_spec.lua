local support = require("support")

describe("clock", function()
    local store

    local function load_clock()
        return support.require_fresh("clock")
    end

    local function shared_config(payload)
        local escaped = payload:gsub('"', '\\"')
        return table.concat({
            '"UserRoamingConfigStore"',
            "{",
            '\t"Software"',
            "\t{",
            '\t\t"Valve"',
            "\t\t{",
            '\t\t\t"Steam"',
            "\t\t\t{",
            '\t\t\t\t"FriendsUI"',
            "\t\t\t\t{",
            '\t\t\t\t\t"FriendsUIJSON"\t\t"' .. escaped .. '"',
            "\t\t\t\t}",
            "\t\t\t}",
            "\t\t}",
            "\t}",
            "}",
        }, "\n")
    end

    local function local_config(payload)
        local escaped = payload:gsub('"', '\\"')
        return table.concat({
            '"UserLocalConfigStore"',
            "{",
            '\t"Software"',
            "\t{",
            '\t\t"Valve"',
            "\t\t{",
            '\t\t\t"Steam"',
            "\t\t\t{",
            '\t\t\t\t"FriendsUI"',
            "\t\t\t\t{",
            '\t\t\t\t\t"FriendsUIJSON"\t\t"' .. escaped .. '"',
            "\t\t\t\t}",
            "\t\t\t}",
            "\t\t}",
            "\t}",
            "}",
        }, "\n")
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

    it("reads the 24-hour setting from the roaming shared config", function()
        support.set_env("MILLENNIUM__STEAM_PATH", "/steam")
        store.seed("/steam/userdata/123/7/remote/sharedconfig.vdf", shared_config('{"b24HourClock":true}'))
        assert.is_true(load_clock().is_24h())
    end)

    it("reports the 12-hour setting as false", function()
        support.set_env("MILLENNIUM__STEAM_PATH", "/steam")
        store.seed("/steam/userdata/123/7/remote/sharedconfig.vdf", shared_config('{"b24HourClock":false}'))
        assert.is_false(load_clock().is_24h())
    end)

    it("falls back to the local config file", function()
        support.set_env("MILLENNIUM__STEAM_PATH", "/steam")
        store.seed("/steam/userdata/123/config/localconfig.vdf", local_config('{"b24HourClock":true}'))
        assert.is_true(load_clock().is_24h())
    end)

    it("returns nil when no config carries the setting", function()
        support.set_env("MILLENNIUM__STEAM_PATH", "/steam")
        store.seed("/steam/userdata/123/7/remote/sharedconfig.vdf", shared_config('{"bChatFontSize":2}'))
        assert.is_nil(load_clock().is_24h())
    end)

    it("returns nil when the Steam path is unavailable", function()
        support.hide_env("MILLENNIUM__STEAM_PATH")
        assert.is_nil(load_clock().is_24h())
    end)
end)
