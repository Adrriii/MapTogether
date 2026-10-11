-- quaver_ipc - plugin-side IPC library
-- Reliable bidirectional messaging over config.yaml.

local IPC = {}
do
    local _session     = nil
    local _outMsgs     = {}   -- reliable outgoing, pending ACK
    local _ackedSet    = {}   -- companion msg IDs we have processed (set)
    local _seq         = 0
    local _onMsg       = nil
    local _roOut       = {}   -- our read-only fields
    local _compEnv     = {}   -- last companion envelope, echoed verbatim
    local _compRo      = {}   -- companion read-only fields
    local _lastPingVal  = nil -- last companion ping value we processed
    local _lastPingTime = 0   -- imgui.GetTime() when last ping arrived (seconds)
    local _lastTickTime = 0   -- imgui.GetTime() of last tick (seconds)
    local PING_INTERVAL = 500 -- ms; must match companion's PING_MS
    local TICK_INTERVAL = 0.05 -- seconds between IPC ticks
    local PING_TIMEOUT  = 15  -- seconds
    local _rev          = 0

    local FORMAT        = "json"

    local function _touch() _rev = _rev + 1 end

    local function _unpack(msg)
        if type(msg.data) ~= "string" then return msg end
        local ok, payload = pcall(json.parse, msg.data)
        if not ok or type(payload) ~= "table" then return msg end
        payload.id, payload.session = msg.id, msg.session
        return payload
    end

    local function _sameKeys(a, b)
        for k in pairs(a) do if not b[k] then return false end end
        for k in pairs(b) do if not a[k] then return false end end
        return true
    end

    function IPC.start()
        math.randomseed(math.floor(state.UnixTime or 0))
        _session     = string.format("s%x_%04x",
                           math.floor(state.UnixTime or 0) % 0x100000,
                           math.random(0, 0xffff))
        _outMsgs     = {}
        _ackedSet    = {}
        _seq         = 0
        _roOut       = { format = FORMAT }
        _compEnv     = {}
        _compRo      = {}
        _lastPingVal  = nil
        _lastPingTime = 0
        _lastTickTime = 0
        _rev          = math.floor(state.UnixTime or 0)
        -- Immediately claim the file with the new session and an empty companion
        -- section so stale pings from a previous session cannot be read on the
        -- first tick and falsely mark the session as alive.
        write({
            session   = _session,
            plugin    = { ro = {}, rev = _rev },
            companion = {},
        })
    end

    function IPC.stop()
        write({ session   = false,
                plugin    = { ro = {} },
                companion = _compEnv })
        _session = nil
    end

    function IPC.restart()
        IPC.stop()
        IPC.start()
    end

    function IPC.session() return _session end

    function IPC.send(payload)
        if not _session then return nil end
        _seq = _seq + 1
        local msg = { id = "p" .. _seq, session = _session }
        if _compRo.format == FORMAT then
            msg.data = json.serialize(payload)
        else
            for k, v in pairs(payload) do msg[k] = v end
        end
        table.insert(_outMsgs, msg)
        _touch()
        return msg.id
    end

    function IPC.onMessage(cb) _onMsg = cb end
    function IPC.set(key, val)
        if _roOut[key] == val then return end
        _roOut[key] = val
        _touch()
    end
    function IPC.get(key) return _compRo[key] end

    function IPC.isAlive()
        return _session ~= nil
            and _lastPingTime > 0
            and (imgui.GetTime() - _lastPingTime) < PING_TIMEOUT
    end

    function IPC.pingAge()
        if not _session or _lastPingTime == 0 then return nil end
        return (imgui.GetTime() - _lastPingTime) * 1000
    end

    function IPC.pingInterval() return PING_INTERVAL end

    function IPC.tick()
        if not _session then return end
        local now = imgui.GetTime()
        if now - _lastTickTime < TICK_INTERVAL then return end
        _lastTickTime = now

        local ok, doc = pcall(read)
        if not ok or type(doc) ~= "table" then return end
        if tostring(doc.session) ~= _session then
            write({ session = _session, plugin = { ro = _roOut, msgs = _outMsgs, rev = _rev }, companion = {} })
            return
        end

        _compEnv    = doc.companion or {}
        local cMsgs = _compEnv.msgs or {}
        local cAcks = _compEnv.acks or {}
        local cRo   = _compEnv.ro   or {}

        -- Drop our msgs that companion has ACKed
        local cAckSet = {}
        for _, id in ipairs(cAcks) do
            if type(id) == "string" then cAckSet[id] = true end
        end
        local kept = {}
        for _, m in ipairs(_outMsgs) do
            if not cAckSet[m.id] then table.insert(kept, m) end
        end
        if #kept ~= #_outMsgs then _touch() end
        _outMsgs = kept

        -- Index companion's current msgs (for ACK pruning)
        local cMsgIdSet = {}
        for _, m in ipairs(cMsgs) do
            if type(m) == "table" and type(m.id) == "string" then
                cMsgIdSet[m.id] = true
            end
        end

        -- Prune ACKs whose source msgs are already gone
        local freshAcked = {}
        for id in pairs(_ackedSet) do
            if cMsgIdSet[id] then freshAcked[id] = true end
        end

        -- Process new companion messages
        for _, msg in ipairs(cMsgs) do
            if type(msg) == "table"
               and tostring(msg.session) == _session
               and not freshAcked[msg.id]
			   and not _ackedSet[msg.id] then
                freshAcked[msg.id] = true
                if _onMsg then
                    local handled, err = pcall(_onMsg, _unpack(msg))
                    if not handled then print("error", "MapTogether: " .. tostring(err)) end
                end
            end
        end
        if not _sameKeys(freshAcked, _ackedSet) then _touch() end
        _ackedSet = freshAcked

        -- Keepalive: detect new ping from companion, echo as pong
        local ping = tonumber(cRo.ping)
        if ping and ping ~= _lastPingVal then
            _lastPingVal  = ping
            _lastPingTime = imgui.GetTime()
            _roOut.pong   = ping
            _touch()
        end
        _compRo = cRo

        -- Close session if companion has gone silent
        if _lastPingTime > 0 and (imgui.GetTime() - _lastPingTime) >= PING_TIMEOUT then
            IPC.restart()
            return
        end

        -- Write
        if tonumber((doc.plugin or {}).rev) == _rev then return end
        local acksArr = {}
        for id in pairs(_ackedSet) do table.insert(acksArr, id) end

        local pluginNode = { ro = _roOut, rev = _rev }
        if #_outMsgs > 0 then pluginNode.msgs = _outMsgs end
        if #acksArr   > 0 then pluginNode.acks = acksArr   end

        write({
            session   = _session,
            plugin    = pluginNode,
            companion = _compEnv,
        })
    end
end
