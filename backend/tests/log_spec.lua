local support = require("support")

describe("log", function()
    local log
    local store
    local logger

    local LOGS_PATH = "/logs"
    local LOG_FILE = "/logs/steamapp-verlock.log"

    before_each(function()
        support.reset()
        store = support.use_fake_fs()
        logger = support.stub_logger()
        support.set_env("MILLENNIUM__LOGS_PATH", LOGS_PATH)
        log = support.require_fresh("log")
    end)

    after_each(function()
        support.cleanup()
    end)

    it("resolves the file under MILLENNIUM__LOGS_PATH", function()
        assert.equals(LOG_FILE, log.path())
    end)

    it("resolves no file when the logs path is absent", function()
        support.hide_env("MILLENNIUM__LOGS_PATH")
        assert.is_nil(log.path())
    end)

    it("creates the logs directory once", function()
        log.info("one")
        log.info("two")
        assert.equals(1, store.calls.create_directories or 0)
    end)

    it("appends a tagged line and passes it to the logger", function()
        support.set_time(1700000000)
        log.info("hello")
        local line = "2023-11-14T22:13:20Z [backend] hello\n"
        assert.equals(line, store.read(LOG_FILE))
        assert.equals(1, #logger.calls)
        assert.equals("info", logger.calls[1].level)
        assert.equals(line, logger.calls[1].message)
    end)

    it("writes warn and error at their levels", function()
        log.warn("careful")
        log.error("bad")
        local content = store.read(LOG_FILE)
        assert.is_truthy(content:find("[backend] careful", 1, true))
        assert.is_truthy(content:find("[backend] bad", 1, true))
        assert.equals("warn", logger.calls[1].level)
        assert.equals("error", logger.calls[2].level)
    end)

    it("tags a relayed frontend record with the frontend source", function()
        log.persist("frontend", "info", "from ui")
        assert.is_truthy(logger.calls[1].message:find("[frontend] from ui", 1, true))
    end)

    it("ignores an unknown level", function()
        log.persist("backend", "debug", "nope")
        assert.equals(0, #logger.calls)
        assert.is_nil(store.read(LOG_FILE))
    end)

    it("does not raise when the append fails", function()
        store.fail_next("append")
        assert.has_no.errors(function()
            log.error("fails")
        end)
        assert.equals(1, #logger.calls)
    end)

    it("does not raise when the directory creation fails", function()
        store.fail_next("create_directories")
        assert.has_no.errors(function()
            log.info("still")
        end)
        assert.equals(1, #logger.calls)
    end)
end)
