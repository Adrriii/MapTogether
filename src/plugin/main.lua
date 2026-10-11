-- ================================================================
-- MapTogether - Quaver collaborative map editing
-- ================================================================

-- @import ./config.lua
-- @import ../quaver_ipc/main.lua
-- @import ./companion.lua
-- @import ./perform.lua
-- @import ./marker.lua
-- @import ./sync.lua
-- @import ./network.lua

-- ── Helpers ───────────────────────────────────────────────────────────────────
local function formatTime(ms)
    ms = tonumber(ms)
    if not ms or ms < 0 then return "--:--.---" end
    local hours   = math.floor(ms / 3600000)
    local minutes = math.floor(ms / 60000) % 60
    local seconds = math.floor(ms / 1000)  % 60
    local millis  = math.floor(ms) % 1000
    if hours > 0 then
        return string.format("%d:%02d:%02d.%03d", hours, minutes, seconds, millis)
    end
    return string.format("%02d:%02d.%03d", minutes, seconds, millis)
end

local function minorVersion(version)
    return tostring(version):match("^v?(%d+%.%d+)") or tostring(version)
end

local function toColorRgb(color)
    return string.format("%d,%d,%d",
        math.floor(color[1] * 255), math.floor(color[2] * 255), math.floor(color[3] * 255))
end

-- ── Bookmark helpers ──────────────────────────────────────────────────────────
local _peerBookmarks = {}

local function hasBookmark(bookmark)
    for _, bm in ipairs(map.Bookmarks) do
        if bm == bookmark then return true end
    end
    return false
end

function clearMTBookmarks()
    local toRemove = {}
    for _, bm in ipairs(map.Bookmarks) do
        if tostring(bm.Note or ""):sub(1, #CFG.bookmarkPrefix) == CFG.bookmarkPrefix then
            table.insert(toRemove, bm)
        end
    end
    for _, bm in ipairs(toRemove) do Perform.RemoveBookmark(bm) end
    _peerBookmarks = {}
end

function updatePeerBookmarks()
    if not Network.isConnected() then return end
    local active = {}
    for _, peer in ipairs(Network.getCollaborators()) do
        active[peer.clientId] = true
        local time    = math.floor(peer.cursorTime or 0)
        local current = _peerBookmarks[peer.clientId]
        if current and current.time ~= time and hasBookmark(current.bookmark) then
            Perform.MoveBookmark(current.bookmark, time - current.time)
            current.time = time
        elseif not current or current.time ~= time then
            local bookmark = utils.CreateBookmark(time, CFG.bookmarkPrefix .. peer.name, toColorRgb(peer.color))
            Perform.AddBookmark(bookmark)
            _peerBookmarks[peer.clientId] = { time = time, bookmark = bookmark }
        end
    end
    for clientId, entry in pairs(_peerBookmarks) do
        if not active[clientId] then
            Perform.RemoveBookmark(entry.bookmark)
            _peerBookmarks[clientId] = nil
        end
    end
end

-- ── Style ─────────────────────────────────────────────────────────────────────
local function pushStyle()
    imgui.PushStyleColor(imgui_col.WindowBg,             { 0.10, 0.10, 0.10, 1.00 })
    imgui.PushStyleColor(imgui_col.TitleBg,              { 0.10, 0.10, 0.10, 1.00 })
    imgui.PushStyleColor(imgui_col.TitleBgActive,        { 0.16, 0.18, 0.20, 1.00 })
    imgui.PushStyleColor(imgui_col.TitleBgCollapsed,     { 0.16, 0.18, 0.20, 1.00 })
    imgui.PushStyleColor(imgui_col.Button,               { 0.24, 0.52, 0.56, 0.60 })
    imgui.PushStyleColor(imgui_col.ButtonHovered,        { 0.32, 0.64, 0.68, 1.00 })
    imgui.PushStyleColor(imgui_col.ButtonActive,         { 0.18, 0.74, 0.80, 1.00 })
    imgui.PushStyleColor(imgui_col.FrameBg,              { 0.16, 0.20, 0.26, 0.70 })
    imgui.PushStyleColor(imgui_col.FrameBgHovered,       { 0.28, 0.38, 0.50, 0.80 })
    imgui.PushStyleColor(imgui_col.FrameBgActive,        { 0.16, 0.26, 0.38, 0.80 })
    imgui.PushStyleColor(imgui_col.Separator,            { 0.26, 0.26, 0.26, 1.00 })
    imgui.PushStyleColor(imgui_col.SeparatorHovered,     { 0.40, 0.40, 0.40, 1.00 })
    imgui.PushStyleColor(imgui_col.SeparatorActive,      { 0.55, 0.55, 0.55, 1.00 })
    imgui.PushStyleColor(imgui_col.ScrollbarGrab,        { 0.44, 0.44, 0.44, 1.00 })
    imgui.PushStyleColor(imgui_col.ScrollbarGrabHovered, { 0.70, 0.70, 0.70, 1.00 })
    imgui.PushStyleColor(imgui_col.ScrollbarGrabActive,  { 0.95, 0.95, 0.95, 1.00 })
    imgui.PushStyleVar(imgui_style_var.WindowPadding,    { 16, 10 })
    imgui.PushStyleVar(imgui_style_var.FramePadding,     {  8,  4 })
    imgui.PushStyleVar(imgui_style_var.ItemSpacing,      {  8,  5 })
    imgui.PushStyleVar(imgui_style_var.WindowBorderSize, 0)
    imgui.PushStyleVar(imgui_style_var.WindowRounding,   4)
    imgui.PushStyleVar(imgui_style_var.FrameRounding,    3)
    imgui.PushStyleVar(imgui_style_var.ScrollbarSize,    10)
end

local function popStyle()
    imgui.PopStyleColor(16)
    imgui.PopStyleVar(7)
end

local function sp()
    imgui.Dummy({ 0, 4 })
end

local function section(title)
    imgui.Dummy({ 0, 2 })
    imgui.Separator()
    imgui.Dummy({ 0, 3 })
    imgui.TextColored({ 0.50, 0.50, 0.50, 1 }, string.upper(title))
    imgui.Dummy({ 0, 1 })
end

-- ── Panel: connection header ──────────────────────────────────────────────────
local shareMap = false

local function drawSharing(syncState)
    if not (Network.isConnected() and Network.isHost() and syncState == "SYNCED") then
        shareMap = false
    else
        local _, checked = imgui.Checkbox("Let people download my map", shareMap)
        shareMap = checked == true
        if imgui.IsItemHovered() then
            imgui.SetTooltip("Anyone browsing lobbies in the companion window can download your saved mapset.")
        end
    end
    Companion.setSharing(shareMap)
end

local function drawConnectionPanel()
    local connected = Network.isConnected()
    local connecting = Network.isConnecting()
    local syncState = Sync.state()

    if Network.lastError then
        imgui.PushTextWrapPos(0)
        imgui.TextColored({ 0.85, 0.35, 0.35, 1 }, Network.lastError)
        imgui.PopTextWrapPos()
    end

    if connected or connecting then
        if imgui.SmallButton("Disconnect") then Network.disconnect() end
    else
        if imgui.SmallButton("Host this map") then Network.connect() end
    end
    drawSharing(syncState)

    if connected and syncState == "SCANNING" then
        sp()
        imgui.PushTextWrapPos(0)
        imgui.TextColored({ 1.00, 0.85, 0.20, 1 },
            "Save the map to continue (Ctrl+S)")
        imgui.PopTextWrapPos()
    end
end

-- ── Panel: network status (bottom) ───────────────────────────────────────────
local function drawNetworkStatus()
    sp()
    imgui.Separator()
    imgui.Dummy({ 0, 2 })

    local companionAlive = IPC.isAlive()
    local connected      = Network.isConnected()
    local connecting     = Network.isConnecting()
    local age            = IPC.pingAge()
    local reconnecting   = connected and age and age > IPC.pingInterval() * 2
    local syncState      = Sync.state()

    local notice = Companion.notice()
    if companionAlive and notice ~= "" then
        imgui.PushTextWrapPos(0)
        imgui.TextColored({ 0.85, 0.35, 0.35, 1 }, notice)
        imgui.PopTextWrapPos()
        if imgui.SmallButton("Copy download link") then imgui.SetClipboardText(CFG.downloadUrl) end
    end

    if not companionAlive then
        imgui.PushTextWrapPos(0)
        imgui.TextColored({ 0.85, 0.35, 0.35, 1 },
            "Companion offline: start maptogether-companion, or download it from " .. CFG.downloadUrl)
        imgui.PopTextWrapPos()
        if imgui.SmallButton("Copy download link") then imgui.SetClipboardText(CFG.downloadUrl) end
    elseif not connected and not connecting then
        imgui.TextColored({ 0.40, 0.80, 0.55, 1 }, "Companion link active")
    elseif reconnecting then
        imgui.TextColored({ 0.90, 0.60, 0.10, 1 }, "[~] Reconnecting...")
    elseif connected and Network.resuming then
        imgui.TextColored({ 0.90, 0.60, 0.10, 1 }, "[~] Server connection lost, resuming the session...")
    elseif connected and syncState == "SYNCED" then
        imgui.TextColored({ 0.40, 1.00, 0.40, 1 }, "[+] Connected")
        if Network.isHost() then
            imgui.SameLine()
            imgui.TextColored({ 1.00, 0.35, 0.35, 1 }, "[Host]")
        end
    elseif connected and syncState == "SCANNING" then
        imgui.TextColored({ 0.90, 0.80, 0.20, 1 }, "[~] Identifying map...")
    elseif connected and syncState == "RECONCILING" then
        imgui.TextColored({ 0.90, 0.80, 0.20, 1 }, "[~] Map conflict detected")
    elseif connected and Network.getRole() == "joiner" then
        imgui.TextColored({ 0.90, 0.80, 0.20, 1 }, "[~] Waiting for approval...")
    elseif connecting then
        imgui.TextColored({ 0.90, 0.80, 0.20, 1 }, "[~] Connecting...")
    end
end

-- ── Panel: reconciliation ─────────────────────────────────────────────────────
local function drawReconciliationPanel()
    local syncState = Sync.state()

    local joiners = Sync.pendingJoiners()
    if #joiners > 0 then
        section("Pending joiners")
        for _, j in ipairs(joiners) do
            local matchColor = { 0.60, 0.60, 0.60, 1 }
            local matchLabel = j.match or "?"
            if     matchLabel == "MATCH"       then matchColor = { 0.40, 1.00, 0.40, 1 }
            elseif matchLabel == "SAME_MAPSET"  then matchColor = { 0.90, 0.80, 0.20, 1 }
            elseif matchLabel == "DIVERGED"     then matchColor = { 1.00, 0.60, 0.20, 1 }
            elseif matchLabel == "FOREIGN"      then matchColor = { 1.00, 0.35, 0.35, 1 }
            end

            imgui.TextColored({ 1, 1, 1, 0.85 }, j.username)
            imgui.SameLine()
            imgui.TextColored(matchColor, "[" .. matchLabel .. "]")
            imgui.SameLine()
            if j.descriptor then
                if imgui.SmallButton("Accept##" .. j.clientId) then
                    Sync.acceptJoiner(j.clientId)
                end
            else
                imgui.TextColored({ 0.60, 0.60, 0.60, 1 }, "saving their map...")
            end
            imgui.SameLine()
            if imgui.SmallButton("Kick##" .. j.clientId) then
                Sync.kickJoiner(j.clientId)
            end

            local d = j.descriptor
            if d then
                local info = string.format("%s  -  %s  (%s, %d notes, %s)",
                    d.title or "?", d.difficultyName or "?",
                    d.mode or "?", d.noteCount or 0,
                    formatTime(d.mapLenMs or 0))
                imgui.PushTextWrapPos(0)
                imgui.TextColored({ 0.50, 0.50, 0.50, 1 }, info)
                imgui.PopTextWrapPos()
            end
        end
    end

    if syncState == "RECONCILING" then
        local match    = Sync.reconcileMatch()
        local hostDesc = Sync.hostDescriptor()
        section("Map check required")
        if     match == "SAME_MAPSET" then
            imgui.TextColored({ 0.90, 0.80, 0.20, 1 }, "Same song, different difficulty or version.")
        elseif match == "DIVERGED" then
            imgui.TextColored({ 1.00, 0.60, 0.20, 1 }, "Same map, different local state.")
        elseif match == "FOREIGN" then
            imgui.TextColored({ 1.00, 0.35, 0.35, 1 }, "Different map loaded.")
        end
        if hostDesc then
            local info = string.format("Host: %s  -  %s  (%s, %d notes, %s)",
                hostDesc.title or "?", hostDesc.difficultyName or "?",
                hostDesc.mode or "?", hostDesc.noteCount or 0,
                formatTime(hostDesc.mapLenMs or 0))
            sp()
            imgui.PushTextWrapPos(0)
            imgui.TextColored({ 0.55, 0.55, 0.55, 1 }, info)
            imgui.PopTextWrapPos()
        end
        sp()
        if imgui.SmallButton("Adopt host's map (overwrites local)") then
            Sync.adopt()
        end
        imgui.SameLine()
        if imgui.SmallButton("Abort") then Network.disconnect() end
    end
end

-- ── Panel: session browser ────────────────────────────────────────────────────
local function drawSessionBrowser()
    if Network.isConnected() or Network.isConnecting() then return end
    section("Public Sessions")
    local sessions = Network.sessionList()
    if #sessions == 0 then
        imgui.TextColored({ 0.45, 0.45, 0.45, 1 }, "No public sessions.")
    else
        for _, s in ipairs(sessions) do
            local d   = s.descriptor
            local lbl = string.format("[%d/%d]  %s", s.playerCount, s.maxPlayers, s.hostUsername)
            if d then
                lbl = lbl .. string.format("  -  %s  %s  (%d notes)",
                    d.title or "?", d.mode or "", d.noteCount or 0)
            end
            if imgui.SmallButton("Join##" .. s.id) then
                Network.joinSession(s.id)
            end
            imgui.SameLine()
            imgui.PushTextWrapPos(0)
            imgui.TextWrapped(lbl)
            imgui.PopTextWrapPos()
        end
    end
end

-- ── Panel: collaborator list ──────────────────────────────────────────────────
local function goToOnClick(peer)
    if imgui.IsItemHovered() then imgui.SetTooltip("Go to " .. peer.name) end
    if not imgui.IsItemClicked() then return end
    actions.GoToObjects(tostring(math.max(1, math.floor(tonumber(peer.cursorTime) or 0))))
end

local function drawCollaboratorList()
    local peers = Network.getCollaborators()
    section("Collaborators  (" .. #peers .. ")")
    if #peers == 0 then
        imgui.TextColored({ 0.45, 0.45, 0.45, 1 }, "You're alone.")
        return
    end
    for _, peer in ipairs(peers) do
        if peer.isHost then
            imgui.TextColored({ 1.00, 0.35, 0.35, 1 }, "[H]")
            imgui.SameLine()
        end
        imgui.TextColored(peer.color, peer.name)
        goToOnClick(peer)
        imgui.SameLine()
        imgui.TextColored({ 0.50, 0.50, 0.50, 1 }, formatTime(peer.cursorTime))
        goToOnClick(peer)
    end
    local selfSuffix = Network.isHost() and " [Host]" or ""
    imgui.TextColored({ 1, 1, 1, 0.40 }, Companion.username() .. " (you)" .. selfSuffix)
    imgui.SameLine()
    imgui.TextColored({ 0.50, 0.50, 0.50, 1 }, formatTime(state.SongTime or 0))
end

-- ── Main entry point ──────────────────────────────────────────────────────────
function draw()
    Sync.checkGap()
    Companion.tick()
    Network.tick()
    updatePeerBookmarks()

    pushStyle()
    imgui.SetNextWindowSizeConstraints({ 260, 0 }, { 9999, 9999 })
    imgui.Begin("MapTogether  " .. CFG.version)

    drawConnectionPanel()

    if Network.isConnected() or Network.isConnecting() then
        drawReconciliationPanel()
        if Sync.state() == "SYNCED" then
            drawCollaboratorList()
        end
    else
        drawSessionBrowser()
    end

    if Sync.merging() then
        sp()
        imgui.TextColored({ 0.90, 0.80, 0.20, 1 }, "[~] Merging edits made while the window was closed...")
    end

    if Sync.mergeRefused then
        sp()
        imgui.PushTextWrapPos(0)
        imgui.TextColored({ 1.00, 0.60, 0.20, 1 },
            "Your map had changed too much while the window was closed, so it was replaced with the session's map instead of merged.")
        imgui.PopTextWrapPos()
        if imgui.SmallButton("Dismiss##merge") then Sync.mergeRefused = false end
    end

    if Sync.unsavedPeerEdits then
        sp()
        imgui.PushTextWrapPos(0)
        imgui.TextColored({ 1.00, 0.85, 0.20, 1 },
            "Peer edits don't mark the map as unsaved. Make any edit of your own, then save (Ctrl+S) before leaving.")
        imgui.PopTextWrapPos()
        if imgui.SmallButton("Dismiss") then Sync.unsavedPeerEdits = false end
    end

    if Sync.unsyncedAction then
        sp()
        imgui.PushTextWrapPos(0)
        imgui.TextColored({ 1.00, 0.60, 0.20, 1 },
            "\"" .. tostring(Sync.unsyncedAction) .. "\" isn't synced yet, peers no longer match your map.")
        imgui.PopTextWrapPos()
        if imgui.SmallButton("Dismiss##unsynced") then Sync.unsyncedAction = nil end
    end

    local companionVer = tostring(Companion.version() or "")
    if companionVer ~= "" and minorVersion(companionVer) ~= minorVersion(CFG.version) then
        sp()
        imgui.Separator()
        imgui.Dummy({ 0, 2 })
        imgui.TextColored({ 1.00, 0.45, 0.15, 1 },
            "[!] Version mismatch")
        imgui.PushTextWrapPos(0)
        imgui.TextColored({ 0.65, 0.65, 0.65, 1 },
            string.format("Plugin %s / companion %s - please update.", CFG.version, companionVer))
        imgui.PopTextWrapPos()
    end

    drawNetworkStatus()

    imgui.End()
    popStyle()
    Sync.endFrame()
end
