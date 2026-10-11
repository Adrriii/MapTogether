local GAP_MS = 10000
local MERGE_REMOVAL_LIMIT = 50
local CHECK_INTERVAL_MS = 4000
local CHECK_MS_PER_NOTE = 0.5
local IDLE_CHECK_FACTOR = 3
local HOST_GAP_KEEP_MS = 60000
local HEAL_BACKOFF_MS = 15000
local MAX_HEAL_BACKOFF_MS = 60000

local SYNC_STATE = {
    IDLE = 'IDLE',
    SCANNING = 'SCANNING',
    RECONCILING = 'RECONCILING',
    SYNCED = 'SYNCED',
}

local Sync = {
    unsavedPeerEdits = false,
    unsyncedAction   = nil,
    mergeRefused     = false,
}
do
    local _isJoiner           = false  -- true while scanning as a joiner (no session create on map found)
    local _pendingJoiners = {}  -- list of { clientId, username, descriptor, match }
    local _hostDescriptor = nil
    local _reconcileMatch = nil -- 'MATCH'|'SAME_MAPSET'|'DIVERGED'|'FOREIGN'
    local _merge          = nil
    local _lastDraw       = nil
    local _seq            = 0
    local _lid            = 0
    local _unacked        = {}
    local _heal           = false
    local _checkedSeq     = nil
    local _nextCheck      = 0
    local _gap            = nil
    local _gapUntil       = nil
    local _resume         = false
    local _placed         = nil
    local _heals          = 0
    local _healOwn        = {}
    local _nextHeal       = 0

    local _send

    local function _mergeWith(snap, conflicts, own)
        local outgoing = Perform.merge(snap, conflicts, own)
        local notes = #(snap.hitObjects or {})
        if Perform.countRemovedNotes(outgoing) > math.max(MERGE_REMOVAL_LIMIT, notes / 2) then
            Perform.applySnapshot(snap)
            Sync.mergeRefused = true
            return
        end
        if #outgoing.EditorActions > 0 then _send(outgoing) end
        Sync.unsavedPeerEdits = true
    end

    function _send(encoded)
        _lid = _lid + 1
        local lid = "l" .. _lid
        _unacked[lid] = encoded
        Companion.sendAction(encoded, lid)
    end

    local function _share(encoded)
        if _merge then Perform.touch(encoded, _merge.own) end
        if _gap and not _gapUntil then Perform.touch(encoded, _gap) end
        if _heal then table.insert(_healOwn, encoded) end
        _send(encoded)
    end

    local function _sendPlacedShape()
        if not _placed then return end
        local reshaped = Perform.reshaped(_placed.sent, _placed.live)
        _placed = nil
        if reshaped then _share(reshaped) end
    end

    local _state = SYNC_STATE.IDLE
    function Sync.state() return _state end
    function Sync.setState(state)
        if SYNC_STATE[state] then _state = state end
    end

    function Sync.hostDescriptor() return _hostDescriptor end
    function Sync.reconcileMatch() return _reconcileMatch end
    function Sync.pendingJoiners() return _pendingJoiners end

    function Sync.startAsHost()
        Sync.setState(SYNC_STATE.SCANNING)
        _pendingJoiners   = {}
        _hostDescriptor   = nil
        _reconcileMatch   = nil
        Marker.add()
    end

    function Sync.stop()
        Marker.remove()
        Sync.setState(SYNC_STATE.IDLE)
        _isJoiner           = false
        _pendingJoiners     = {}
        _hostDescriptor     = nil
        _reconcileMatch     = nil
        _merge              = nil
        _seq                = 0
        _unacked            = {}
        _heal               = false
        _checkedSeq         = nil
        _gap                = nil
        _gapUntil           = nil
        _resume             = false
        _placed             = nil
        _heals              = 0
        _healOwn            = {}
        _nextHeal           = 0
    end

    function Sync.onConnectionLost()
        _pendingJoiners = {}
        if _state ~= SYNC_STATE.SYNCED then return end
        if not _gap or _gapUntil then _gap = {} end
        _gapUntil = nil
        _merge = nil
        _heal = false
        _resume = false
        for _, encoded in pairs(_unacked) do Perform.touch(encoded, _gap) end
    end

    function Sync.onResumed(isHost)
        _unacked = {}
        _resume = not isHost
        _gapUntil = isHost and state.UnixTime + HOST_GAP_KEEP_MS or nil
        Sync.setState(SYNC_STATE.SYNCED)
    end

    function Sync.resuming() return _gap ~= nil and not _gapUntil end

    function Sync.merging() return _merge ~= nil end

    function Sync.checkGap()
        if _merge and #Network.getCollaborators() == 0 then _merge = nil end
        local gap = _lastDraw and state.UnixTime - _lastDraw or 0
        if gap < GAP_MS or _state ~= SYNC_STATE.SYNCED or #Network.getCollaborators() == 0 then return end
        _merge = { conflicts = {}, own = {} }
        Companion.resync()
    end

    function Sync.endFrame()
        _lastDraw = state.UnixTime
        if _gapUntil and state.UnixTime > _gapUntil then
            _gap = nil
            _gapUntil = nil
        end
        if imgui.IsMouseDown(0) then return end
        _sendPlacedShape()
        Sync.sendCheck()
    end

    function Sync.sendCheck()
        if _state ~= SYNC_STATE.SYNCED or not Network.isHost() or #Network.getCollaborators() == 0 then return end
        if _merge or Sync.resuming() or next(_unacked) or state.UnixTime < _nextCheck then return end
        local interval = CHECK_INTERVAL_MS + #map.HitObjects * CHECK_MS_PER_NOTE
        if _seq == _checkedSeq then interval = interval * IDLE_CHECK_FACTOR end
        _checkedSeq = _seq
        _nextCheck = state.UnixTime + interval
        Companion.sendCheck(_seq, Perform.hash())
    end

    function Sync.onCheck(seq, hash)
        if _state ~= SYNC_STATE.SYNCED or Network.isHost() or _merge or _heal or _resume or next(_unacked) then return end
        if imgui.IsMouseDown(0) then return end
        if tonumber(seq) ~= _seq then return end
        local mine = Perform.hash()
        if mine == tostring(hash) then
            _heals = 0
            return
        end
        if state.UnixTime < _nextHeal then return end
        _heals = _heals + 1
        _nextHeal = state.UnixTime + math.min(HEAL_BACKOFF_MS * 2 ^ (_heals - 1), MAX_HEAL_BACKOFF_MS)
        Companion.debug({ heal = _heals, host = tostring(hash), mine = mine })
        _heal = true
        _healOwn = {}
        Companion.resync()
    end

    function Sync.healing() return _heal end

    function Sync.status()
        local unacked = 0
        for _ in pairs(_unacked) do unacked = unacked + 1 end
        return { seq = _seq, unacked = unacked, heal = _heal, merge = _merge ~= nil, state = _state }
    end

    function Sync.onRemoteAction(a, gseq)
        _seq = tonumber(gseq) or _seq
        if _merge then
            Perform.touch(a, _merge.conflicts)
            return
        end
        if _heal or _resume then return end
        Perform.apply(a)
        Sync.unsavedPeerEdits = true
    end

    function Sync.onActionAck(lid, gseq)
        _unacked[tostring(lid)] = nil
        _seq = tonumber(gseq) or _seq
    end

    -- Scan the joiner's map first; join_session is sent only after the map is identified.
    function Sync.startScanForJoin(sessionId)
        Sync.setState(SYNC_STATE.SCANNING)
        _isJoiner           = true
        Marker.add()
    end

    function Sync.onMapFound(descriptor)
        Marker.remove()
        if _state == SYNC_STATE.SCANNING then
            if _isJoiner then
                _isJoiner = false
                Sync.setState(SYNC_STATE.IDLE)
            else
                Sync.setState(SYNC_STATE.SYNCED)
                Companion.createSession()
            end
        end
    end

    function Sync.onJoiner(info)
        Sync.dropJoiner(info.clientId)
        table.insert(_pendingJoiners, info)
    end

    function Sync.acceptJoiner(clientId)
        Companion.acceptJoiner(clientId)
        Sync.dropJoiner(clientId)
    end

    function Sync.kickJoiner(clientId)
        Companion.kickJoiner(clientId)
        Sync.dropJoiner(clientId)
    end

    function Sync.dropJoiner(clientId)
        for i, j in ipairs(_pendingJoiners) do
            if j.clientId == clientId then
                table.remove(_pendingJoiners, i)
                return
            end
        end
    end

    -- Called when server confirms we are live (covers MATCH joiners who get no CLASSIFICATION)
    function Sync.onSynced()
        Sync.setState(SYNC_STATE.SYNCED)
    end

    -- Called when we are a joiner and server tells us the match classification
    function Sync.onClassification(match, hostDesc)
        _reconcileMatch  = match
        _hostDescriptor  = hostDesc
        Sync.setState(SYNC_STATE.RECONCILING)
    end

    function Sync.sendSnapshot(clientId)
        local pending = {}
        for lid in pairs(_unacked) do table.insert(pending, lid) end
        local snap = Perform.snapshot()
        if _gap then snap.gap = Perform.windowList(_gap) end
        Companion.sendSnapshot(clientId, snap, _seq, pending)
    end

    -- Joiner adopts host's map (requests snapshot)
    function Sync.adopt()
        Companion.adoptHostMap()
    end

    -- Apply a received snapshot (wipes local map)
    function Sync.applySnapshot(snap, seq)
        snap = Perform.unpack(snap)
        _seq = tonumber(seq) or _seq
        if _heal then
            _heal = false
            Perform.applySnapshot(snap)
            Perform.replay(_healOwn)
            _healOwn = {}
            return
        end
        if _resume then
            _resume = false
            local own = _gap or {}
            _gap = nil
            _mergeWith(snap, Perform.resumeConflicts(own, Perform.windowSet(snap.gap)), {})
            return
        end
        if _merge then
            local conflicts = Network.isHost() and {} or _merge.conflicts
            local own = _merge.own
            _merge = nil
            _mergeWith(snap, conflicts, own)
            return
        end
        Perform.applySnapshot(snap)
        Sync.unsavedPeerEdits = true
    end

    listen(function(action, kind)
        if kind == history_type.Silent then return end
        if Sync.state() ~= SYNC_STATE.SYNCED then return end

        _placed = nil
        local encoded, unsupported = Perform.encode(action, kind == history_type.Undo)
        if not encoded then
            Sync.unsyncedAction = unsupported
            return
        end
        _share(encoded)
        if kind == history_type.New and encoded.Type == "PlaceHitObject" then
            _placed = { live = action.HitObject, sent = encoded.HitObject }
        end
    end)
end