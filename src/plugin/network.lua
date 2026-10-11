
local PEER_COLORS = {
    { 0.95, 0.40, 0.40, 1 },
    { 0.40, 0.80, 1.00, 1 },
    { 0.55, 0.95, 0.55, 1 },
    { 1.00, 0.80, 0.30, 1 },
    { 0.80, 0.50, 1.00, 1 },
}

Network = {
    collaborators = {},
    colorMap      = {},
    wasAlive      = false,
    sessionId     = nil,
    role          = nil,        -- 'host' | 'joiner' | nil
    hostClientId  = nil,
    intentional   = false,      -- true only when user explicitly connected/joined
    lastError     = nil,
}

local function isTrue(value)
    return value == true or value == "true"
end

function Network.hasPeer(clientId)
    for _, c in ipairs(Network.collaborators) do
        if c.clientId == clientId then return true end
    end
    return false
end

function Network.addPeer(clientId, username, isHost)
    if not Network.colorMap[clientId] then
        local idx = 0
        for _ in pairs(Network.colorMap) do idx = idx + 1 end
        Network.colorMap[clientId] = PEER_COLORS[((idx) % #PEER_COLORS) + 1]
    end
    table.insert(Network.collaborators, {
        clientId   = clientId,
        name       = username,
        color      = Network.colorMap[clientId],
        cursorTime = 0,
        isHost     = isTrue(isHost),
    })
end

function Network.removePeer(clientId)
    local kept = {}
    for _, c in ipairs(Network.collaborators) do
        if c.clientId ~= clientId then table.insert(kept, c) end
    end
    Network.collaborators = kept
end

function Network.connect()
    Network.collaborators = {}
    Network.colorMap      = {}
    Network.wasAlive      = false
    Network.sessionId     = nil
    Network.role          = nil
    Network.hostClientId  = nil
    Network.intentional   = true
    Network.lastError     = nil
    Sync.startAsHost()
end

function Network.joinSession(sessionId)
    Network.collaborators = {}
    Network.colorMap      = {}
    Network.wasAlive      = false
    Network.sessionId     = sessionId
    Network.role          = "joiner"
    Network.intentional   = true
    Network.lastError     = nil
    Sync.startScanForJoin(sessionId)
    Companion.joinSession(sessionId)
end

function Network.disconnect()
    Network.resuming = false
    Companion.leave()
    Sync.stop()
    Network.collaborators = {}
    Network.colorMap      = {}
    Network.sessionId     = nil
    Network.role          = nil
    Network.hostClientId  = nil
    Network.intentional   = false
    clearMTBookmarks()
end

function Network.isConnected()  return IPC.isAlive() and Network.intentional end
function Network.isConnecting() return IPC.session() ~= nil and not IPC.isAlive() and Network.intentional end
function Network.sessionList()  return Companion.sessions() end
function Network.getRole()      return Network.role or "" end
function Network.isHost()       return Network.role == "host" end
function Network.getCollaborators() return Network.collaborators end

function Network.tick()
    local alive = IPC.isAlive()

    if Network.wasAlive and not alive then Network.disconnect() end
    Network.wasAlive = alive

    if not alive then return end

    local instance = Companion.instance()
    if instance and Network.companionInstance and instance ~= Network.companionInstance and Network.intentional then
        Network.disconnect()
        Network.lastError = "The companion restarted, so the session was left. Host or join again."
    end
    Network.companionInstance = instance or Network.companionInstance

    for _, cursor in ipairs(Companion.peers()) do
        for _, c in ipairs(Network.collaborators) do
            if c.clientId == cursor.clientId then c.cursorTime = tonumber(cursor.time) or 0 end
        end
    end
end

Companion.onMessage(function(msg)
    if msg.type == "map_found" then
        Sync.onMapFound(msg.descriptor)

    elseif msg.type == "session_created" then
        Network.sessionId     = msg.sessionId
        Network.role          = "host"
        Network.collaborators = {}
        Network.colorMap      = {}
        clearMTBookmarks()

    elseif msg.type == "connection_lost" then
        Network.resuming      = true
        Network.collaborators = {}
        Sync.onConnectionLost()

    elseif msg.type == "session_resumed" then
        local isHost          = isTrue(msg.host)
        Network.resuming      = false
        Network.role          = isHost and "host" or "joiner"
        Network.collaborators = {}
        Network.lastError     = nil
        Sync.onResumed(isHost)

    elseif msg.type == "session_lost" then
        Network.resuming = false
        Network.disconnect()
        Network.lastError = "The session was lost (the server restarted or the connection dropped). Host or join again."

    elseif msg.type == "joiner" then
        Sync.onJoiner({
            clientId   = msg.clientId,
            username   = msg.username,
            descriptor = msg.descriptor,
            match      = msg.match,
        })

    elseif msg.type == "synced" then
        if msg.hostClientId then Network.hostClientId = msg.hostClientId end
        Sync.onSynced()

    elseif msg.type == "classification" then
        Sync.onClassification(msg.match, msg.hostDescriptor)

    elseif msg.type == "snapshot_request" then
        Sync.sendSnapshot(msg.targetId)

    elseif msg.type == "snapshot" then
        Sync.applySnapshot(msg.snapshot, msg.seq)

    elseif msg.type == "action" then
        if msg.action then Sync.onRemoteAction(msg.action, msg.gseq) end

    elseif msg.type == "action_ack" then
        Sync.onActionAck(msg.lid, msg.gseq)

    elseif msg.type == "join_request" then
        if not Network.isConnected() and not Network.isConnecting() then Network.joinSession(msg.sessionId) end

    elseif msg.type == "check" then
        Sync.onCheck(msg.seq, msg.hash)

    elseif msg.type == "peer_joined" then
        if not Network.hasPeer(msg.clientId) then
            Network.addPeer(msg.clientId, msg.username, msg.isHost)
        end

    elseif msg.type == "peer_left" then
        Network.removePeer(msg.clientId)
        Sync.dropJoiner(msg.clientId)

    elseif msg.type == "server_error" then
        Network.lastError = tostring(msg.message or "Server error")
        Network.disconnect()

    elseif msg.type == "host_changed" then
        Network.hostClientId = msg.hostClientId
        if isTrue(msg.youAreHost) then Network.role = "host" end
        for _, c in ipairs(Network.collaborators) do
            c.isHost = (c.clientId == msg.hostClientId)
        end

    elseif msg.type == "kicked" then
        Network.disconnect()
    end
end)