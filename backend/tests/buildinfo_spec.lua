local support = require("support")

describe("buildinfo", function()
    local buildinfo

    before_each(function()
        support.reset()
        support.install_json()
        buildinfo = support.require_fresh("buildinfo")
    end)

    after_each(function()
        support.cleanup()
    end)

    it("strips console noise from a captured dump", function()
        local cleaned = buildinfo.clean(support.read_fixture("app_info_print_440.txt"))
        assert.is_string(cleaned)
        assert.is_nil(cleaned:find("] app_info_print", 1, true))
        assert.is_nil(cleaned:find("AppID :", 1, true))
        assert.is_nil(cleaned:find("Connectivity state changed", 1, true))
        assert.is_not_nil(cleaned:find('"440"', 1, true))
        assert.is_not_nil(cleaned:find("buildid", 1, true))
    end)

    it("drops command echoes and trailing notes before parsing", function()
        local raw = table.concat({
            "app_info_update 1",
            "app_info_print 1222670",
            "AppID : 1222670, change number : 1/0",
            '"1222670"',
            "{",
            '\t"appid"\t\t"1222670"',
            '\t"buildid"\t\t"42"',
            '\t"depots"',
            "\t{",
            '\t\t"441"',
            "\t\t{",
            '\t\t\t"manifests"',
            "\t\t\t{",
            '\t\t\t\t"public"\t\t"7"',
            "\t\t\t}",
            "\t\t}",
            "\t}",
            "}",
            "Connectivity state changed: 2",
            "",
        }, "\n")
        local info, err = buildinfo.parse(buildinfo.clean(raw))
        assert.is_nil(err)
        assert.equals("42", info.buildid)
        assert.equals("7", info.depots["441"])
    end)

    it("extracts the app block from a dump without newlines", function()
        local raw = support.read_fixture("app_info_print_440.txt"):gsub("\n", "")
        local info, err = buildinfo.parse(buildinfo.clean(raw))
        assert.is_nil(err)
        assert.equals("12345678", info.buildid)
        assert.equals("7588696787324571854", info.depots["441"])
    end)

    it("extracts the app block from a dump with line prefixes", function()
        local raw = support.read_fixture("app_info_print_440.txt"):gsub("([^\n]+)", "[steam] %1")
        local info, err = buildinfo.parse(buildinfo.clean(raw))
        assert.is_nil(err)
        assert.equals("12345678", info.buildid)
        assert.equals("7588696787324571854", info.depots["441"])
    end)

    it("rejects a dump that carries only the command echo", function()
        local info, err = buildinfo.parse(buildinfo.clean("app_info_print 1222670\n"))
        assert.is_nil(info)
        assert.is_string(err)
    end)

    it("parses the buildid and depot manifests", function()
        local info, err = buildinfo.parse(buildinfo.clean(support.read_fixture("app_info_print_440.txt")))
        assert.is_nil(err)
        assert.is_not_nil(info)
        assert.equals("12345678", info.buildid)
        assert.equals("7588696787324571854", info.depots["441"])
        assert.equals("3704041027226853666", info.depots["442"])
    end)

    it("parses a multi-depot dump", function()
        local info, err = buildinfo.parse(buildinfo.clean(support.read_fixture("app_info_print_multi_depot.txt")))
        assert.is_nil(err)
        assert.equals("20000000", info.buildid)
        assert.equals("1111111111111111111", info.depots["570"])
        assert.equals("2222222222222222222", info.depots["571"])
        assert.equals("3333333333333333333", info.depots["580"])
    end)

    it("reads the public branch rather than a beta branch", function()
        local info, err = buildinfo.parse(buildinfo.clean(support.read_fixture("app_info_print_beta.txt")))
        assert.is_nil(err)
        assert.equals("30000000", info.buildid)
    end)

    it("parses the pre-refresh baseline dump", function()
        local info, err = buildinfo.parse(buildinfo.clean(support.read_fixture("app_info_print_stale_first.txt")))
        assert.is_nil(err)
        assert.equals("10000000", info.buildid)
        assert.equals("1000000000000000001", info.depots["441"])
    end)

    it("rejects an empty dump", function()
        local info, err = buildinfo.parse(buildinfo.clean(support.read_fixture("app_info_print_empty.txt")))
        assert.is_nil(info)
        assert.is_string(err)
    end)

    it("accepts a complete BuildInfo", function()
        local ok, err = buildinfo.validate({ buildid = "12345678", depots = { ["441"] = "7588696787324571854" } })
        assert.is_true(ok)
        assert.is_nil(err)
    end)

    it("rejects a BuildInfo without a buildid", function()
        local ok = buildinfo.validate({ depots = { ["441"] = "7588696787324571854" } })
        assert.is_true(support.is_failure(ok))
    end)

    it("rejects a BuildInfo without depots", function()
        local ok = buildinfo.validate({ buildid = "12345678", depots = {} })
        assert.is_true(support.is_failure(ok))
    end)

    it("rejects a BuildInfo with no fields", function()
        local ok = buildinfo.validate({})
        assert.is_true(support.is_failure(ok))
    end)
end)
