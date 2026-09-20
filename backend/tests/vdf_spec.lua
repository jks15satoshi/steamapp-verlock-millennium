local support = require("support")

describe("vdf", function()
    local vdf

    before_each(function()
        support.reset()
        support.install_json()
        support.use_fake_fs()
        support.stub_logger()
        support.stub_millennium()
        vdf = support.require_fresh("vdf")
    end)

    after_each(function()
        support.cleanup()
    end)

    it("round-trips a flat table", function()
        local state = { name = "Team Fortress 2", appid = "440" }
        local text = vdf.serialize(state)
        local parsed, err = vdf.parse(text)
        assert.is_nil(err)
        assert.same(state, parsed)
    end)

    it("round-trips nested objects", function()
        local state = {
            AppState = {
                appid = "440",
                InstalledDepots = {
                    ["441"] = { manifest = "7588696787324571854" },
                    ["442"] = { manifest = "3704041027226853666" },
                },
            },
        }
        local parsed, err = vdf.parse(vdf.serialize(state))
        assert.is_nil(err)
        assert.same(state, parsed)
    end)

    it("quotes keys and values in serialized output", function()
        local text = vdf.serialize({ name = "Team Fortress 2" })
        assert.matches('"name"%s+"Team Fortress 2"', text)
    end)

    it("round-trips values that contain quotes and backslashes", function()
        local state = { root = { quote = 'say "hi"', slash = "a\\b" } }
        local parsed, err = vdf.parse(vdf.serialize(state))
        assert.is_nil(err)
        assert.equals('say "hi"', parsed.root.quote)
        assert.equals("a\\b", parsed.root.slash)
    end)

    it("decodes escaped quotes and backslashes when parsing", function()
        local text = '"root"\n{\n\t"quote"\t\t"say \\"hi\\""\n\t"slash"\t\t"a\\\\b"\n}\n'
        local parsed, err = vdf.parse(text)
        assert.is_nil(err)
        assert.equals('say "hi"', parsed.root.quote)
        assert.equals("a\\b", parsed.root.slash)
    end)

    it("ignores line and block comments", function()
        local text = table.concat({
            "// a leading comment",
            '"root"',
            "{",
            '\t"a"\t\t"1" // a trailing comment',
            "\t/* a block comment */",
            '\t"b"\t\t"2"',
            "}",
            "",
        }, "\n")
        local parsed, err = vdf.parse(text)
        assert.is_nil(err)
        assert.equals("1", parsed.root.a)
        assert.equals("2", parsed.root.b)
    end)

    it("preserves quoting when a parsed tree is re-serialized", function()
        local text = '"root"\n{\n\t"a"\t\t"value with spaces"\n}\n'
        local parsed, err = vdf.parse(text)
        assert.is_nil(err)
        assert.equals(text, vdf.serialize(parsed))
    end)

    it("reproduces a commented, nested, quoted, and escaped fixture byte-for-byte", function()
        local text = support.read_fixture("vdf_commented.vdf")
        local parsed, err = vdf.parse(text)
        assert.is_nil(err)
        assert.is_not_nil(parsed)
        assert.equals(text, vdf.serialize(parsed))
    end)

    it("reproduces an appmanifest fixture byte-for-byte", function()
        local text = support.read_fixture("appmanifest_440.acf")
        local parsed, err = vdf.parse(text)
        assert.is_nil(err)
        assert.equals(text, vdf.serialize(parsed))
    end)

    it("preserves block comments and blank-line layout byte-for-byte", function()
        local text = table.concat({
            "/* header */",
            '"root"',
            "{",
            "\t/* a */",
            '\t"a"\t\t"1"',
            "\t/* multi",
            "line */",
            '\t"b"\t\t"2"',
            "}",
            "",
        }, "\n")
        local parsed, err = vdf.parse(text)
        assert.is_nil(err)
        assert.equals(text, vdf.serialize(parsed))
    end)

    it("keeps comments and key order when a parsed field is mutated", function()
        local text = support.read_fixture("vdf_commented.vdf")
        local parsed = assert(vdf.parse(text))
        parsed.AppState.StateFlags = "4"
        local out = vdf.serialize(parsed)
        assert.is_not_nil(out:find("// identity", 1, true))
        assert.is_not_nil(out:find("// install state", 1, true))
        assert.is_not_nil(out:find("// pinned depot", 1, true))
        local order = { '"appid"', '"name"', '"StateFlags"', '"buildid"', '"InstalledDepots"', '"quoted"', '"slashed"' }
        local previous = 0
        for _, token in ipairs(order) do
            local index = out:find(token, previous + 1, true)
            assert.is_not_nil(index)
            assert.is_true(index > previous)
            previous = index
        end
        assert.equals(text:gsub('"StateFlags"%s+"2"', '"StateFlags"\t\t"4"'), out)
    end)

    it("appends a new key after the existing entries", function()
        local text = support.read_fixture("vdf_commented.vdf")
        local parsed = assert(vdf.parse(text))
        parsed.AppState.TargetBuildID = "0"
        local out = vdf.serialize(parsed)
        assert.equals(text:gsub("}\n$", '\t"TargetBuildID"\t\t"0"\n}\n'), out)
    end)

    it("releases parsed trees once they are unreachable", function()
        local meta
        for index = 1, 64 do
            local name, value = debug.getupvalue(vdf.parse, index)
            if name == nil then
                break
            end
            if name == "META" then
                meta = value
                break
            end
        end
        assert.is_not_nil(meta, "vdf.parse should close over the metadata cache")

        local lines = { '"root"', "{" }
        for index = 1, 500 do
            table.insert(lines, string.format('\t"key%d"\n\t{\n\t\t"value"\t\t"%s"\n\t}', index, string.rep("x", 128)))
        end
        table.insert(lines, "}")
        local text = table.concat(lines, "\n")

        for _ = 1, 50 do
            if vdf.parse(text) == nil then
                error("vdf.parse returned nil")
            end
        end

        local entries = 0
        for _ in pairs(meta) do
            entries = entries + 1
        end
        assert.is_true(entries > 0, "the metadata cache should hold the parsed trees while they are reachable")

        for _ = 1, 4 do
            collectgarbage("collect")
        end

        entries = 0
        for _ in pairs(meta) do
            entries = entries + 1
        end
        assert.equals(0, entries)
    end)

    it("returns an error on malformed text", function()
        local parsed, err = vdf.parse('"root"\n{\n\t"a"\t\t"1"\n')
        assert.is_nil(parsed)
        assert.is_string(err)
    end)

    it("returns an error when a string is unterminated", function()
        local parsed, err = vdf.parse('"root"\n{\n\t"a"\t\t"1\n}\n')
        assert.is_nil(parsed)
        assert.is_string(err)
    end)
end)
