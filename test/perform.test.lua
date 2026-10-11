local NAMES = {
    "PlaceHitObject", "RemoveHitObject", "PlaceHitObjectBatch", "RemoveHitObjectBatch", "ResizeLongNote",
    "MoveHitObjects", "FlipHitObjects", "ReverseHitObjects", "ChangeTimingPointOffset", "EditBookmark",
    "AddScrollVelocityBatch", "RemoveScrollVelocityBatch", "ChangeScrollVelocityMultiplierBatch", "ChangeScrollVelocityOffsetBatch",
    "AddScrollVelocity", "ChangeTimingPointBpmBatch", "ChangeTimingPointBpm", "Batch", "ResnapHitObjects",
    "AddTimingPointBatch", "RemoveTimingPointBatch", "AddBookmarkBatch", "RemoveBookmarkBatch",
    "AddScrollSpeedFactorBatch", "RemoveScrollSpeedFactorBatch", "CreateTimingGroup", "RemoveTimingGroup",
    "CreateLayer", "RemoveLayer", "RenameLayer", "ToggleLayerVisibility", "ColorLayer", "MoveToLayer",
    "RenameTimingGroup", "MoveObjectsToTimingGroup", "ColorTimingGroup",
}
CFG = { bookmarkPrefix = ">> " }
hitobject_type = { Normal = "Normal", Mine = "Mine" }
time_signature = { Quadruple = "Quadruple", Triple = "Triple" }
action_type = {}
for _, n in ipairs(NAMES) do action_type[n] = "AT_" .. n end

local function byTime(a, b)
    if a.StartTime ~= b.StartTime then return a.StartTime < b.StartTime end
    return (a.Lane or 0) < (b.Lane or 0)
end

local function newGroup(svs, initial, color)
    return { ScrollVelocities = svs or {}, ScrollSpeedFactors = {}, InitialScrollVelocity = initial or 1, ColorRgb = color }
end

local function newMap()
    local m = { HitObjects = {}, TimingPoints = {}, Bookmarks = {}, EditorLayers = {}, DefaultLayer = { Name = "Default" },
                groups = { ["$Default"] = newGroup(), ["$Global"] = newGroup() } }
    m.GetKeyCount = function() return 4 end
    m.GetTimingGroup = function(id) return m.groups[id] end
    m.GetTimingGroupIds = function()
        local ids = {}
        for id in pairs(m.groups) do table.insert(ids, id) end
        table.sort(ids)
        return ids
    end
    return m
end

local function sortAll(m)
    table.sort(m.HitObjects, byTime)
    table.sort(m.TimingPoints, byTime)
    table.sort(m.Bookmarks, byTime)
    table.sort(m.groups["$Default"].ScrollVelocities, byTime)
end

local function removeRef(list, obj)
    for i, x in ipairs(list) do if x == obj then table.remove(list, i) return end end
    error("object not in list")
end

utils = {
    CreateHitObject = function(st, lane, et, hs, layer, ty, tg)
        return { StartTime = st, Lane = lane, EndTime = et, HitSound = hs, EditorLayer = layer, Type = ty, TimingGroup = tg }
    end,
    CreateTimingPoint = function(st, bpm, sig, hidden) return { StartTime = st, Bpm = bpm, Signature = sig, Hidden = hidden } end,
    CreateScrollVelocity = function(st, m) return { StartTime = st, Multiplier = m } end,
    CreateBookmark = function(st, note, color) return { StartTime = st, Note = note, ColorRgb = color } end,
    CreateScrollSpeedFactor = function(st, m) return { StartTime = st, Multiplier = m } end,
    CreateScrollGroup = function(svs, initial, color) return newGroup(svs, initial, color) end,
    CreateEditorLayer = function(name, hidden, color) return { Name = name, Hidden = hidden, ColorRgb = color } end,
    CreateEditorAction = function(t, ...) return { Type = t, args = { ... } } end,
}

local EXEC = {
    PlaceHitObject = function(m, ho) table.insert(m.HitObjects, ho) end,
    RemoveHitObject = function(m, ho) removeRef(m.HitObjects, ho) end,
    PlaceHitObjectBatch = function(m, l) for _, h in ipairs(l) do table.insert(m.HitObjects, h) end end,
    RemoveHitObjectBatch = function(m, l) for _, h in ipairs(l) do removeRef(m.HitObjects, h) end end,
    ResizeLongNote = function(m, ho, _, new) ho.EndTime = new end,
    MoveHitObjects = function(m, l, lane, drag)
        for _, h in ipairs(l) do
            h.StartTime = h.StartTime + drag
            if h.EndTime > 0 then h.EndTime = h.EndTime + drag end
            h.Lane = h.Lane + lane
        end
    end,
    FlipHitObjects = function(m, l) for _, h in ipairs(l) do h.Lane = 4 - h.Lane + 1 end end,
    ReverseHitObjects = function(m, l)
        local start, stop = l[1].StartTime, l[#l].StartTime
        for _, h in ipairs(l) do stop = math.max(stop, h.EndTime) end
        for _, h in ipairs(l) do
            if h.EndTime > 0 then
                local s = h.StartTime
                h.StartTime = stop - (h.EndTime - start)
                h.EndTime = stop - (s - start)
            else
                h.StartTime = stop - (h.StartTime - start)
            end
        end
    end,
    ChangeTimingPointOffset = function(m, tp, new) tp.StartTime = new end,
    ChangeTimingPointBpm = function(m, tp, bpm) tp.Bpm = bpm end,
    EditBookmark = function(m, bm, note) bm.Note = note end,
    AddScrollVelocityBatch = function(m, l, g) for _, sv in ipairs(l) do table.insert(g.ScrollVelocities, sv) end end,
    RemoveScrollVelocityBatch = function(m, l, g) for _, sv in ipairs(l) do removeRef(g.ScrollVelocities, sv) end end,
    ChangeScrollVelocityMultiplierBatch = function(m, l, mult) for _, sv in ipairs(l) do sv.Multiplier = mult end end,
    ChangeScrollVelocityOffsetBatch = function(m, l, offset) for _, sv in ipairs(l) do sv.StartTime = sv.StartTime + offset end end,
    AddTimingPointBatch = function(m, l) for _, x in ipairs(l) do table.insert(m.TimingPoints, x) end end,
    RemoveTimingPointBatch = function(m, l) for _, x in ipairs(l) do removeRef(m.TimingPoints, x) end end,
    AddBookmarkBatch = function(m, l) for _, x in ipairs(l) do table.insert(m.Bookmarks, x) end end,
    RemoveBookmarkBatch = function(m, l) for _, x in ipairs(l) do removeRef(m.Bookmarks, x) end end,
    AddScrollSpeedFactorBatch = function(m, l, g) for _, x in ipairs(l) do table.insert(g.ScrollSpeedFactors, x) end end,
    RemoveScrollSpeedFactorBatch = function(m, l, g) for _, x in ipairs(l) do removeRef(g.ScrollSpeedFactors, x) end end,
    CreateTimingGroup = function(m, id, group, hos)
        m.groups[id] = group
        for _, h in ipairs(hos or {}) do h.TimingGroup = id end
    end,
    RemoveTimingGroup = function(m, id)
        m.groups[id] = nil
        for _, h in ipairs(m.HitObjects) do if h.TimingGroup == id then h.TimingGroup = "$Default" end end
    end,
    RenameTimingGroup = function(m, old, new)
        m.groups[new], m.groups[old] = m.groups[old], nil
        for _, h in ipairs(m.HitObjects) do if h.TimingGroup == old then h.TimingGroup = new end end
    end,
    MoveObjectsToTimingGroup = function(m, hos, id) for _, h in ipairs(hos) do h.TimingGroup = id end end,
    ColorTimingGroup = function(m, id, r, g, b) m.groups[id].ColorRgb = r .. "," .. g .. "," .. b end,
    RenameLayer = function(m, layer, name) layer.Name = name end,
    ToggleLayerVisibility = function(m, layer) layer.Hidden = not layer.Hidden end,
    ColorLayer = function(m, layer, r, g, b) layer.ColorRgb = r .. "," .. g .. "," .. b end,
    MoveToLayer = function(m, layer, hos)
        local index = 0
        for i, l in ipairs(m.EditorLayers) do if l == layer then index = i end end
        for _, h in ipairs(hos) do h.EditorLayer = index end
    end,
    CreateLayer = function(m, layer) table.insert(m.EditorLayers, layer) end,
    RemoveLayer = function(m, layer) removeRef(m.EditorLayers, layer) end,
}

local function exec(name, ...)
    EXEC[name](map, ...)
    sortAll(map)
end

local performed = 0
actions = {
    PerformSilently = function(a)
        performed = performed + 1
        exec(a.Type:sub(4), table.unpack(a.args))
    end,
}

local function wire(v)
    if type(v) == "table" then
        local out = {}
        for k, x in pairs(v) do out[k] = wire(x) end
        return out
    end
    if v == nil then return nil end
    return tostring(v)
end

local function dump(m)
    local parts = {}
    for _, h in ipairs(m.HitObjects) do
        table.insert(parts, ("H%s:%s:%s:%s:%s:%s"):format(h.StartTime, h.Lane, h.EndTime, tostring(h.Type), h.EditorLayer, h.TimingGroup))
    end
    for _, t in ipairs(m.TimingPoints) do table.insert(parts, ("T%s:%s"):format(t.StartTime, t.Bpm)) end
    for _, b in ipairs(m.Bookmarks) do table.insert(parts, ("B%s:%s"):format(b.StartTime, b.Note)) end
    for _, id in ipairs(m.GetTimingGroupIds()) do
        local g = m.groups[id]
        table.insert(parts, ("G%s:%s:%s"):format(id, g.InitialScrollVelocity, tostring(g.ColorRgb)))
        for _, s in ipairs(g.ScrollVelocities) do table.insert(parts, ("S%s:%s"):format(s.StartTime, s.Multiplier)) end
        for _, f in ipairs(g.ScrollSpeedFactors) do table.insert(parts, ("F%s:%s"):format(f.StartTime, f.Multiplier)) end
    end
    for _, l in ipairs(m.EditorLayers) do table.insert(parts, ("L%s:%s:%s"):format(l.Name, tostring(l.Hidden), tostring(l.ColorRgb))) end
    return table.concat(parts, " ")
end

local A, B = newMap(), newMap()
local checks = 0

local function sync(liveAction, undo, label)
    local encoded, unsupported = Perform.encode(liveAction, undo)
    assert(encoded, label .. ": unsupported " .. tostring(unsupported))
    map = B
    Perform.apply(wire(encoded))
    map = A
    local a, b = dump(A), dump(B)
    if a ~= b then error(label .. " diverged\n  A: " .. a .. "\n  B: " .. b) end
    checks = checks + 1
end

local function roundTrip(label, name, live, args, undoArgs)
    map = A
    exec(name, table.unpack(args))
    live.Type = live.Type or action_type[name]
    sync(live, false, label)
    if undoArgs then
        exec(undoArgs[1], table.unpack(undoArgs, 2))
        sync(live, true, label .. " (undo)")
    end
end

local function note(st, lane, et, ty) return utils.CreateHitObject(st, lane, et or 0, 0, 0, ty or "Normal", "$Default") end

for _, m in ipairs({ A, B }) do
    map = m
    exec("PlaceHitObjectBatch", { note(100, 1), note(200, 2), note(300, 3, 450), note(400, 4, 0, "Mine") })
    table.insert(m.TimingPoints, utils.CreateTimingPoint(0, 180, "Quadruple", false))
    table.insert(m.Bookmarks, utils.CreateBookmark(50, "intro"))
    exec("AddScrollVelocityBatch", { utils.CreateScrollVelocity(0, 1), utils.CreateScrollVelocity(250, 2) }, m.groups["$Default"])
    m.EditorLayers = {
        utils.CreateEditorLayer("L1", false, "255,255,255"),
        utils.CreateEditorLayer("L2", false, "255,255,255"),
    }
end
map = A

local placed = note(500, 2)
roundTrip("place", "PlaceHitObject", { HitObject = placed }, { placed }, { "RemoveHitObject", placed })

local toRemove = A.HitObjects[1]
roundTrip("remove", "RemoveHitObject", { HitObject = toRemove }, { toRemove }, { "PlaceHitObject", toRemove })

local ln = A.HitObjects[3]
roundTrip("resize", "ResizeLongNote", { HitObject = ln, OriginalTime = 450, NewTime = 600 }, { ln, 450, 600 }, { "ResizeLongNote", ln, 600, 450 })

local sel = { A.HitObjects[1], A.HitObjects[2], A.HitObjects[4] }
roundTrip("move", "MoveHitObjects", { HitObjects = sel, LaneOffset = 1, DragOffset = -50 }, { sel, 1, -50 }, { "MoveHitObjects", sel, -1, 50 })

local all = { A.HitObjects[1], A.HitObjects[2], A.HitObjects[3], A.HitObjects[4] }
roundTrip("flip", "FlipHitObjects", { HitObjects = all }, { all }, { "FlipHitObjects", all })


local rev = { A.HitObjects[1], A.HitObjects[2], A.HitObjects[4] }
roundTrip("reverse", "ReverseHitObjects", { HitObjects = rev }, { rev }, { "ReverseHitObjects", rev })

do
    map = A
    local ho = A.HitObjects[2]
    local s0, e0 = ho.StartTime, ho.EndTime
    ho.StartTime = s0 + 7
    sortAll(A)
    local adjustments = { [ho] = { OriginalStartTime = s0, OriginalEndTime = e0, NewStartTime = s0 + 7, NewEndTime = e0 } }
    local live = { Type = action_type.ResnapHitObjects, NoteTimeAdjustments = adjustments }
    sync(live, false, "resnap")
    ho.StartTime = s0
    sortAll(A)
    sync(live, true, "resnap (undo)")
end

local layer = A.EditorLayers[2]
roundTrip("rename layer", "RenameLayer", { Layer = layer, Name = "Hats", Previous = "L2" }, { layer, "Hats" }, { "RenameLayer", layer, "L2" })
roundTrip("toggle layer", "ToggleLayerVisibility", { Layer = layer }, { layer }, { "ToggleLayerVisibility", layer })
roundTrip("color layer", "ColorLayer", { Layer = layer }, { layer, 10, 20, 30 }, { "ColorLayer", layer, 255, 255, 255 })

do
    local hos = { A.HitObjects[1], A.HitObjects[2] }
    local originals = { hos[1].EditorLayer, hos[2].EditorLayer }
    roundTrip("move to layer", "MoveToLayer", { Layer = layer, HitObjects = hos, OriginalLayers = originals }, { layer, hos }, nil)
    hos[1].EditorLayer, hos[2].EditorLayer = originals[1], originals[2]
    sync({ Type = action_type.MoveToLayer, Layer = layer, HitObjects = hos, OriginalLayers = originals }, true, "move to layer (undo)")
end

do
    local kids = { A.HitObjects[1] }
    local tg = utils.CreateScrollGroup({ utils.CreateScrollVelocity(10, 2) }, 1.5, "1,2,3")
    roundTrip("create tg", "CreateTimingGroup", { Id = "tgA", TimingGroup = tg, ChildHitObjects = kids },
        { "tgA", tg, kids }, { "RemoveTimingGroup", "tgA" })
    roundTrip("create tg again", "CreateTimingGroup", { Id = "tgA", TimingGroup = tg, ChildHitObjects = kids }, { "tgA", tg, kids }, nil)
    roundTrip("rename tg", "RenameTimingGroup", { OldId = "tgA", NewId = "tgB" }, { "tgA", "tgB" }, { "RenameTimingGroup", "tgB", "tgA" })

    local hos = { A.HitObjects[3] }
    roundTrip("move to tg", "MoveObjectsToTimingGroup", { HitObjects = hos, TimingGroupId = "tgA", OriginalTimingGroupIds = { hos[1].TimingGroup } },
        { hos, "tgA" }, { "MoveObjectsToTimingGroup", hos, "$Default" })
    roundTrip("color tg", "ColorTimingGroup", { TimingGroup = A.groups.tgA }, { "tgA", 9, 9, 9 }, { "ColorTimingGroup", "tgA", 1, 2, 3 })

    local group = A.groups.tgA
    local children = { A.HitObjects[1] }
    roundTrip("remove tg", "RemoveTimingGroup", { Id = "tgA", TimingGroup = group, ChildHitObjects = children },
        { "tgA" }, { "CreateTimingGroup", "tgA", group, children })
    map = A
end

local tp = A.TimingPoints[1]
roundTrip("tp offset", "ChangeTimingPointOffset", { TimingPoint = tp, OriginalOffset = 0, NewOffset = 25 }, { tp, 25 }, { "ChangeTimingPointOffset", tp, 0 })

local bm = A.Bookmarks[1]
roundTrip("edit bookmark", "EditBookmark", { Bookmark = bm, NewNote = "drop", OldNote = "intro" }, { bm, "drop" }, { "EditBookmark", bm, "intro" })

local svs = A.groups["$Default"].ScrollVelocities
local svSel = { svs[1], svs[2] }
roundTrip("sv multiplier", "ChangeScrollVelocityMultiplierBatch", { ScrollVelocities = svSel, Multiplier = 3 }, { svSel, 3 }, nil)
svSel[1].Multiplier, svSel[2].Multiplier = 1, 2
sync({ Type = action_type.ChangeScrollVelocityMultiplierBatch, ScrollVelocities = svSel, Multiplier = 3 }, true, "sv multiplier (undo)")

local group = A.groups["$Default"]
local sv = utils.CreateScrollVelocity(400, 0.5)
roundTrip("single sv", "AddScrollVelocityBatch", { Type = action_type.AddScrollVelocity, ScrollVelocity = sv, ScrollGroup = group },
    { { sv }, group }, { "RemoveScrollVelocityBatch", { sv }, group })

do
    for _, m in ipairs({ A, B }) do m.groups.svg = newGroup({ utils.CreateScrollVelocity(250, 4) }) end
    local grouped = { A.groups.svg.ScrollVelocities[1] }
    roundTrip("sv multiplier in group", "ChangeScrollVelocityMultiplierBatch", { ScrollVelocities = grouped, Multiplier = 5 }, { grouped, 5 }, nil)
    roundTrip("sv offset in group", "ChangeScrollVelocityOffsetBatch", { ScrollVelocities = grouped, Offset = 30 }, { grouped, 30 },
        { "ChangeScrollVelocityOffsetBatch", grouped, -30 })
    for _, m in ipairs({ A, B }) do m.groups.svg = nil end
end

local bpmSel = { A.TimingPoints[1] }
roundTrip("bpm batch", "ChangeTimingPointBpm", { Type = action_type.ChangeTimingPointBpmBatch, TimingPoints = bpmSel }, { bpmSel[1], 200 }, nil)

do
    map = A
    local p1, p2 = note(800, 1), note(900, 2)
    exec("PlaceHitObjectBatch", { p1, p2 })
    local removed = A.HitObjects[1]
    exec("RemoveHitObject", removed)
    local batch = { Type = action_type.Batch, EditorActions = {
        { Type = action_type.PlaceHitObjectBatch, HitObjects = { p1, p2 } },
        { Type = action_type.RemoveHitObject, HitObject = removed },
    } }
    sync(batch, false, "batch")
    exec("PlaceHitObject", removed)
    exec("RemoveHitObjectBatch", { p1, p2 })
    sync(batch, true, "batch (undo)")
end

do
    local C = newMap()
    map = C
    exec("PlaceHitObjectBatch", { note(10, 1), note(20, 2) })
    table.insert(C.TimingPoints, utils.CreateTimingPoint(5, 120, "Triple", true))
    table.insert(C.Bookmarks, utils.CreateBookmark(15, "stale"))
    table.insert(C.Bookmarks, utils.CreateBookmark(30, ">> Peer"))
    table.insert(C.EditorLayers, utils.CreateEditorLayer("old layer", false, "1,2,3"))
    C.groups.old = newGroup({ utils.CreateScrollVelocity(1, 9) })

    map = A
    table.insert(A.EditorLayers, utils.CreateEditorLayer("drums", true, "255,0,0"))
    A.groups.tg1 = newGroup({ utils.CreateScrollVelocity(100, 0.5) }, 2, "0,255,0")
    table.insert(A.groups.tg1.ScrollSpeedFactors, utils.CreateScrollSpeedFactor(150, 1.5))
    local snap = wire(Perform.snapshot())

    map = C
    Perform.applySnapshot(snap)
    local peer
    for i, bm in ipairs(C.Bookmarks) do
        if bm.Note == ">> Peer" then peer = table.remove(C.Bookmarks, i) break end
    end
    assert(peer, "peer cursor bookmarks survive a snapshot")
    local a, c = dump(A), dump(C)
    if a ~= c then error("snapshot diverged\n  A: " .. a .. "\n  C: " .. c) end
    checks = checks + 1
    map = A
end

do
    local H, J = newMap(), newMap()
    for _, m in ipairs({ H, J }) do
        map = m
        exec("PlaceHitObjectBatch", { note(1000, 1), note(5000, 2), note(20000, 3) })
    end

    map = J
    exec("RemoveHitObject", J.HitObjects[3])
    exec("PlaceHitObject", note(10000, 1))

    local remote = note(10500, 2)
    map = H
    exec("PlaceHitObject", remote)
    local remoteAction = Perform.encode({ Type = action_type.PlaceHitObject, HitObject = remote }, false)

    local conflicts, own = {}, {}
    map = J
    local incoming = wire(remoteAction)
    Perform.touch(incoming, conflicts)
    Perform.apply(incoming)

    local ownNote = note(30000, 4)
    exec("PlaceHitObject", ownNote)
    local ownAction = Perform.encode({ Type = action_type.PlaceHitObject, HitObject = ownNote }, false)
    Perform.touch(ownAction, own)

    map = H
    local snap = wire(Perform.snapshot())
    map = J
    local outgoing = Perform.merge(snap, conflicts, own)
    map = H
    Perform.apply(wire(outgoing))
    Perform.apply(wire(ownAction))

    local h, j = dump(H), dump(J)
    if h ~= j then error("merge diverged\n  H: " .. h .. "\n  J: " .. j) end
    assert(not h:find("H10000:"), "offline edit in a conflicting window is overwritten by the host")
    assert(not h:find("H20000:"), "offline removal outside conflicts is shared")
    assert(h:find("H10500:") and h:find("H30000:"), "remote and own edits are kept")
    checks = checks + 1
    map = A
end

do
    map = A
    local before = dump(A)
    local snap = wire(Perform.snapshot())
    performed = 0
    Perform.applySnapshot(snap)
    assert(performed == 0, "an identical snapshot performs no action, got " .. performed)
    assert(dump(A) == before, "an identical snapshot leaves the map unchanged")
    checks = checks + 1
end

do
    local D, E = newMap(), newMap()
    map = D
    table.insert(D.Bookmarks, utils.CreateBookmark(40, "a|b%7C~\nc", "1,2,3"))
    table.insert(D.Bookmarks, utils.CreateBookmark(50, ""))
    local snap = wire(Perform.snapshot())
    assert(type(snap.bookmarks) == "string", "snapshot lists travel packed")
    map = E
    Perform.applySnapshot(snap)
    local d, e = dump(D), dump(E)
    if d ~= e then error("packed snapshot diverged\n  D: " .. d .. "\n  E: " .. e) end
    assert(E.Bookmarks[1].ColorRgb == "1,2,3" and E.Bookmarks[2].ColorRgb == nil, "bookmark colors survive packing")
    checks = checks + 1
    map = A
end

do
    local F, G = newMap(), newMap()
    table.insert(F.groups["$Default"].ScrollVelocities, utils.CreateScrollVelocity(100, 1))
    table.insert(G.groups["$Default"].ScrollVelocities, utils.CreateScrollVelocity(100, 0.99999))
    map = F
    local f = Perform.hash()
    map = G
    performed = 0
    Perform.applySnapshot(wire((function() map = F; local s = Perform.snapshot(); map = G; return s end)()))
    assert(performed == 0, "values equal to three decimals are not rewritten by a snapshot")
    assert(Perform.hash() == f, "the hash agrees with snapshots on values equal to three decimals")
    checks = checks + 1
    map = A
end

do
    local H = newMap()
    table.insert(H.HitObjects, note(1000, 1))
    table.insert(H.HitObjects, note(1250, 4, 1500))
    table.insert(H.HitObjects, note(1500, 2, 0, "Mine"))
    H.HitObjects[1].EditorLayer = 2
    table.insert(H.TimingPoints, utils.CreateTimingPoint(0.5, 174.999))
    table.insert(H.groups["$Default"].ScrollVelocities, utils.CreateScrollVelocity(100.25, 1.5))
    map = H
    local hash = Perform.hash()
    assert(hash == "h3:1048613164-1:192421-1:3112133", "the hash stays compatible with older plugins, got " .. hash)
    checks = checks + 1
    map = A
end

local encoded, unsupported = Perform.encode({ Type = action_type.CreateLayer }, false)
assert(encoded == nil and unsupported == "AT_CreateLayer", "unsupported actions are reported, got " .. tostring(unsupported))

print(("ok: %d sync checks passed"):format(checks))
