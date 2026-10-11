local Companion = {}
do
    function Companion.tick()
        Companion.updateCursor()

        IPC.tick()
    end

    function Companion.mapMarkerReady(secret)
        IPC.send({ type = "map_marker_ready", secret = secret })
    end

    function Companion.joinSession(sessionId)
        IPC.send({ type = "join_session", sessionId = sessionId })
    end

    function Companion.leave()
        IPC.send({ type = "abort" })
    end

    function Companion.createSession()
        IPC.send({ type = "create_session" })
    end

    function Companion.acceptJoiner(clientId)
        IPC.send({ type = "accept_joiner", targetId = clientId })
    end

    function Companion.kickJoiner(clientId)
        IPC.send({ type = "kick", targetId = clientId })
    end

    function Companion.resync()
        IPC.send({ type = "resync" })
    end

    function Companion.sendCheck(seq, hash)
        IPC.send({ type = "check", seq = seq, hash = hash })
    end

    function Companion.adoptHostMap()
        IPC.send({ type = "adopt" })
    end

    function Companion.debug(anything)
        IPC.send({ type = "debug", data = anything })
    end

    function Companion.sendSnapshot(clientId, snapshot, seq, pending)
        IPC.send({ type = "snapshot", targetId = clientId, snapshot = snapshot, seq = seq, pending = pending })
    end

    function Companion.sendAction(action, lid)
        IPC.send({ type = "action", action = action, lid = lid })
    end

    function Companion.onMessage(callback) IPC.onMessage(callback) end

    -- Read fields

    function Companion.version()
        return IPC.get('companionVersion')
    end

    function Companion.instance()
        return IPC.get('companionInstance')
    end

    function Companion.username()
        return IPC.get('username') or 'Player'
    end

    function Companion.notice()
        return tostring(IPC.get('notice') or "")
    end

    function Companion.sessions()
        local sessions = IPC.get('sessions')
        if type(sessions) ~= "table" then return {} end
        return sessions
    end

    function Companion.peers()
        local peers = IPC.get('peers')
        if type(peers) ~= "table" then return {} end
        return peers
    end

    -- Exposed fields

    function Companion.setSharing(enabled)
        IPC.set("sharing", enabled and "true" or "false")
    end

    function Companion.updateCursor()
        IPC.set("pluginVersion", CFG.version)
        IPC.set("cursor", math.floor(state.SongTime or 0))
    end
end

IPC.start()