local NAMES = {
    "PlaceHitObject", "RemoveHitObject", "ResizeLongNote", "RemoveHitObjectBatch", "PlaceHitObjectBatch",
    "FlipHitObjects", "SwapLanes", "MoveHitObjects", "AddHitsound", "RemoveHitsound", "CreateLayer", "RemoveLayer",
    "RenameLayer", "MoveToLayer", "ColorLayer", "ToggleLayerVisibility", "AddScrollVelocity", "RemoveScrollVelocity",
    "AddScrollVelocityBatch", "RemoveScrollVelocityBatch", "AddTimingPoint", "RemoveTimingPoint", "AddTimingPointBatch",
    "RemoveTimingPointBatch", "ChangePreviewTime", "ChangeTimingPointOffset", "ChangeTimingPointBpm",
    "ChangeTimingPointSignature", "ChangeTimingPointHidden", "ResetTimingPoint", "ChangeTimingPointBpmBatch",
    "ChangeTimingPointSignatureBatch", "ChangeTimingPointOffsetBatch", "ChangeScrollVelocityOffsetBatch",
    "ChangeScrollVelocityMultiplierBatch", "ApplyOffset", "ResnapHitObjects", "Batch", "ReverseHitObjects",
    "AddBookmark", "AddBookmarkBatch", "EditBookmark", "RemoveBookmark", "RemoveBookmarkBatch",
    "ChangeBookmarkOffsetBatch", "CreateTimingGroup", "RemoveTimingGroup", "RenameTimingGroup",
    "MoveObjectsToTimingGroup", "ColorTimingGroup", "AddScrollSpeedFactor", "AddScrollSpeedFactorBatch",
    "RemoveScrollSpeedFactor", "RemoveScrollSpeedFactorBatch",
}

action_type = {}
local TYPE_NAME = {}
for i, name in ipairs(NAMES) do
    action_type[name] = i
    TYPE_NAME[i] = name
end
history_type = { New = 0, Redo = 1, Undo = 2, Silent = 3 }

local function enumValue(enumTable, value, flags)
    local names = {}
    for name, e in pairs(enumTable) do
        if e.value == value then return e end
        if flags and value & e.value ~= 0 then table.insert(names, name) end
    end
    table.sort(names)
    local label = #names > 0 and table.concat(names, ", ") or tostring(value)
    return setmetatable({ value = value }, { __tostring = function() return label end })
end

local function enum(values)
    local t = {}
    for name, n in pairs(values) do t[name] = setmetatable({ value = n }, { __tostring = function() return name end }) end
    return t
end

hitobject_type = enum({ Normal = 0, Mine = 1 })
hitsounds = enum({ Normal = 1, Whistle = 2, Finish = 4, Clap = 8 })
time_signature = enum({ Quadruple = 4, Triple = 3 })

local function clr(value, enumTable, default, flags)
    if value == nil then return default end
    if type(value) == "string" then error("cannot convert a string to a clr type " .. tostring(default)) end
    if type(value) == "number" then return enumValue(enumTable, math.floor(value), flags) end
    return value
end

editor = { errors = {}, performed = 0, active = true }

local function byTime(a, b)
    if a.StartTime ~= b.StartTime then return a.StartTime < b.StartTime end
    return (a.Lane or 0) < (b.Lane or 0)
end

local function newGroup(svs, initial, color)
    return { ScrollVelocities = svs or {}, ScrollSpeedFactors = {}, InitialScrollVelocity = initial or 1, ColorRgb = color }
end

map = {
    Title = "Test Song", Artist = "Tester", Creator = "Adri", DifficultyName = "Hard", MapId = 1000, MapSetId = 100,
    Mode = "Keys4",
    HitObjects = {}, TimingPoints = {}, Bookmarks = {}, EditorLayers = {}, DefaultLayer = { Name = "Default" },
    groups = { ["$Default"] = newGroup(), ["$Global"] = newGroup() },
}
map.GetKeyCount = function() return 4 end
map.GetTimingGroup = function(id) return map.groups[id] end
map.GetTimingGroupIds = function()
    local ids = {}
    for id in pairs(map.groups) do table.insert(ids, id) end
    table.sort(ids)
    return ids
end

local function sortAll()
    table.sort(map.HitObjects, byTime)
    table.sort(map.TimingPoints, byTime)
    table.sort(map.Bookmarks, byTime)
    for _, g in pairs(map.groups) do
        table.sort(g.ScrollVelocities, byTime)
        table.sort(g.ScrollSpeedFactors, byTime)
    end
end

local function removeRef(list, obj)
    for i, x in ipairs(list) do
        if x == obj then
            table.remove(list, i)
            return
        end
    end
    error("object not in list")
end

local function layerIndex(layer)
    for i, l in ipairs(map.EditorLayers) do if l == layer then return i end end
    return 0
end

utils = {
    CreateHitObject = function(st, lane, et, hs, layer, ty, tg)
        return { StartTime = st, Lane = lane, EndTime = et or 0, HitSound = clr(hs, hitsounds, enumValue(hitsounds, 0), true),
                 EditorLayer = layer or 0, Type = clr(ty, hitobject_type, hitobject_type.Normal), TimingGroup = tg or "$Default" }
    end,
    CreateTimingPoint = function(st, bpm, sig, hidden)
        return { StartTime = st, Bpm = bpm, Signature = clr(sig, time_signature, time_signature.Quadruple), Hidden = hidden or false }
    end,
    CreateScrollVelocity = function(st, m) return { StartTime = st, Multiplier = m } end,
    CreateScrollSpeedFactor = function(st, m) return { StartTime = st, Multiplier = m } end,
    CreateBookmark = function(st, note, color) return { StartTime = st, Note = note, ColorRgb = color or "255,255,0" } end,
    CreateScrollGroup = function(svs, initial, color) return newGroup(svs, initial, color) end,
    CreateEditorLayer = function(name, hidden, color) return { Name = name, Hidden = hidden or false, ColorRgb = color or "255,255,255" } end,
    CreateEditorAction = function(t, ...) return { Type = t, args = { ... } } end,
}

local EXEC = {
    PlaceHitObject = function(ho) table.insert(map.HitObjects, ho) end,
    RemoveHitObject = function(ho) removeRef(map.HitObjects, ho) end,
    PlaceHitObjectBatch = function(l) for _, h in ipairs(l) do table.insert(map.HitObjects, h) end end,
    RemoveHitObjectBatch = function(l) for _, h in ipairs(l) do removeRef(map.HitObjects, h) end end,
    ResizeLongNote = function(ho, _, new) ho.EndTime = new end,
    MoveHitObjects = function(l, lane, drag)
        for _, h in ipairs(l) do
            h.StartTime = h.StartTime + drag
            if h.EndTime > 0 then h.EndTime = h.EndTime + drag end
            h.Lane = h.Lane + lane
        end
    end,
    FlipHitObjects = function(l) for _, h in ipairs(l) do h.Lane = 4 - h.Lane + 1 end end,
    AddTimingPoint = function(tp) table.insert(map.TimingPoints, tp) end,
    RemoveTimingPoint = function(tp) removeRef(map.TimingPoints, tp) end,
    AddTimingPointBatch = function(l) for _, x in ipairs(l) do table.insert(map.TimingPoints, x) end end,
    RemoveTimingPointBatch = function(l) for _, x in ipairs(l) do removeRef(map.TimingPoints, x) end end,
    ChangeTimingPointBpm = function(tp, bpm) tp.Bpm = bpm end,
    ChangeTimingPointOffset = function(tp, offset) tp.StartTime = offset end,
    AddBookmark = function(bm) table.insert(map.Bookmarks, bm) end,
    RemoveBookmark = function(bm) for i, x in ipairs(map.Bookmarks) do if x == bm then table.remove(map.Bookmarks, i) return end end end,
    AddBookmarkBatch = function(l) for _, x in ipairs(l) do table.insert(map.Bookmarks, x) end end,
    RemoveBookmarkBatch = function(l) for _, x in ipairs(l) do removeRef(map.Bookmarks, x) end end,
    ChangeBookmarkOffsetBatch = function(l, offset) for _, x in ipairs(l) do x.StartTime = x.StartTime + offset end end,
    AddScrollVelocityBatch = function(l, g) for _, sv in ipairs(l) do table.insert(g.ScrollVelocities, sv) end end,
    RemoveScrollVelocityBatch = function(l, g) for _, sv in ipairs(l) do removeRef(g.ScrollVelocities, sv) end end,
    AddScrollSpeedFactorBatch = function(l, g) for _, x in ipairs(l) do table.insert(g.ScrollSpeedFactors, x) end end,
    RemoveScrollSpeedFactorBatch = function(l, g) for _, x in ipairs(l) do removeRef(g.ScrollSpeedFactors, x) end end,
    ChangeScrollVelocityMultiplierBatch = function(l, mult) for _, sv in ipairs(l) do sv.Multiplier = mult end end,
    CreateTimingGroup = function(id, group, hos)
        map.groups[id] = group
        for _, h in ipairs(hos or {}) do h.TimingGroup = id end
    end,
    RemoveTimingGroup = function(id)
        map.groups[id] = nil
        for _, h in ipairs(map.HitObjects) do if h.TimingGroup == id then h.TimingGroup = "$Default" end end
    end,
    ColorTimingGroup = function(id, r, g, b) map.groups[id].ColorRgb = r .. "," .. g .. "," .. b end,
    CreateLayer = function(layer) table.insert(map.EditorLayers, layer) end,
    RemoveLayer = function(layer)
        local index = layerIndex(layer)
        removeRef(map.EditorLayers, layer)
        local kept = {}
        for _, h in ipairs(map.HitObjects) do
            if h.EditorLayer ~= index then
                if h.EditorLayer > index then h.EditorLayer = h.EditorLayer - 1 end
                table.insert(kept, h)
            end
        end
        map.HitObjects = kept
    end,
    MoveToLayer = function(layer, hos)
        local index = layerIndex(layer)
        for _, h in ipairs(hos) do h.EditorLayer = index end
    end,
}

local undoStack, redoStack = {}, {}

local REVERT = {
    AddBookmark = function(bm)
        for i, x in ipairs(map.Bookmarks) do if x == bm then table.remove(map.Bookmarks, i) return end end
        error("Quaver crashes undoing the add of a bookmark that is gone")
    end,
    ChangeBookmarkOffsetBatch = function(l, offset) EXEC.ChangeBookmarkOffsetBatch(l, -offset) end,
}

local listeners = {}
function listen(fn) table.insert(listeners, fn) end

local function notify(action, kind, fromLua)
    if not editor.active then return end
    for _, fn in ipairs(listeners) do fn(action, kind, fromLua) end
end

local function exec(t, ...)
    local name = TYPE_NAME[t]
    local fn = EXEC[name]
    if not fn then error("mock editor can't perform " .. tostring(name)) end
    fn(...)
    sortAll()
end

actions = {
    PerformSilently = function(a)
        editor.performed = editor.performed + 1
        exec(a.Type, table.unpack(a.args))
        notify(a, history_type.Silent, true)
    end,
    GoToObjects = function(input) state.SongTime = tonumber(input) end,
    Perform = function(a)
        exec(a.Type, table.unpack(a.args))
        table.insert(undoStack, {
            live    = a,
            perform = function() exec(a.Type, table.unpack(a.args)) end,
            revert  = function() REVERT[TYPE_NAME[a.Type]](table.unpack(a.args)) end,
        })
        redoStack = {}
        notify(a, history_type.New, true)
    end,
}

local function userAction(live, perform, revert)
    perform()
    sortAll()
    table.insert(undoStack, { live = live, perform = perform, revert = revert })
    redoStack = {}
    notify(live, history_type.New, false)
end

function editor.place(st, lane, et, ty, hs)
    local ho = utils.CreateHitObject(st, lane, et or 0, hs and hitsounds[hs] or nil, 0, ty and hitobject_type[ty] or nil)
    userAction({ Type = action_type.PlaceHitObject, HitObject = ho },
        function() table.insert(map.HitObjects, ho) end,
        function() removeRef(map.HitObjects, ho) end)
    return ho
end

function editor.find(st, lane)
    for _, ho in ipairs(map.HitObjects) do
        if ho.StartTime == st and ho.Lane == lane then return ho end
    end
end

function editor.remove(st, lane)
    local ho = editor.find(st, lane)
    if not ho then error("no note at " .. st .. ":" .. lane) end
    userAction({ Type = action_type.RemoveHitObject, HitObject = ho },
        function() removeRef(map.HitObjects, ho) end,
        function() table.insert(map.HitObjects, ho) end)
end

function editor.move(times, laneOffset, dragOffset)
    local hos = {}
    for _, t in ipairs(times) do table.insert(hos, editor.find(t[1], t[2])) end
    userAction({ Type = action_type.MoveHitObjects, HitObjects = hos, LaneOffset = laneOffset, DragOffset = dragOffset },
        function() EXEC.MoveHitObjects(hos, laneOffset, dragOffset) end,
        function() EXEC.MoveHitObjects(hos, -laneOffset, -dragOffset) end)
end

function editor.placeBatch(count, from)
    local hos = {}
    for i = 0, count - 1 do table.insert(hos, utils.CreateHitObject(from + i * 10, (i % 4) + 1, 0)) end
    userAction({ Type = action_type.PlaceHitObjectBatch, HitObjects = hos },
        function() EXEC.PlaceHitObjectBatch(hos) end,
        function() EXEC.RemoveHitObjectBatch(hos) end)
end

function editor.addTimingPoint(st, bpm, sig)
    local tp = utils.CreateTimingPoint(st, bpm, sig and time_signature[sig] or nil)
    userAction({ Type = action_type.AddTimingPoint, TimingPoint = tp },
        function() table.insert(map.TimingPoints, tp) end,
        function() removeRef(map.TimingPoints, tp) end)
end

function editor.randomEdit(seed)
    math.randomseed(seed)
    local roll = math.random()
    local count = #map.HitObjects
    if roll < 0.35 or count < 10 then
        local st = math.random(1, 4000) * 25
        local lane = math.random(1, 4)
        if not editor.find(st, lane) then editor.place(st, lane) end
    elseif roll < 0.55 then
        local ho = map.HitObjects[math.random(1, count)]
        editor.remove(ho.StartTime, ho.Lane)
    elseif roll < 0.75 then
        local ho = map.HitObjects[math.random(1, count)]
        local lane = math.random(-1, 1)
        local drag = math.random(1, 8) * 25
        if ho.Lane + lane >= 1 and ho.Lane + lane <= 4 and not editor.find(ho.StartTime + drag, ho.Lane + lane) then
            editor.move({ { ho.StartTime, ho.Lane } }, lane, drag)
        end
    elseif roll < 0.85 then
        editor.undo()
    elseif roll < 0.9 then
        editor.redo()
    elseif roll < 0.95 then
        editor.addTimingPoint(math.random(1, 400) * 250, math.random(100, 250))
    else
        editor.placeBatch(math.random(5, 40), math.random(1, 2000) * 1000 + 1)
    end
end

function editor.undo()
    local entry = table.remove(undoStack)
    if not entry then return end
    entry.revert()
    sortAll()
    table.insert(redoStack, entry)
    notify(entry.live, history_type.Undo, false)
end

function editor.redo()
    local entry = table.remove(redoStack)
    if not entry then return end
    entry.perform()
    sortAll()
    table.insert(undoStack, entry)
    notify(entry.live, history_type.Redo, false)
end

function editor.load(notes)
    map.HitObjects = {}
    for _, n in ipairs(notes) do table.insert(map.HitObjects, utils.CreateHitObject(n[1], n[2], n[3] or 0)) end
    map.TimingPoints = { utils.CreateTimingPoint(0, 180) }
    sortAll()
end

function editor.dump()
    local parts = {}
    for _, h in ipairs(map.HitObjects) do
        table.insert(parts, ("H%s:%s:%s:%s:%s:%s:%s"):format(h.StartTime, h.Lane, h.EndTime, tostring(h.Type), h.EditorLayer, h.TimingGroup, tostring(h.HitSound)))
    end
    for _, t in ipairs(map.TimingPoints) do table.insert(parts, ("T%s:%s:%s"):format(t.StartTime, t.Bpm, tostring(t.Signature))) end
    for _, b in ipairs(map.Bookmarks) do
        if not tostring(b.Note):match("^>> ") then table.insert(parts, ("B%s:%s"):format(b.StartTime, b.Note)) end
    end
    for _, id in ipairs(map.GetTimingGroupIds()) do
        local g = map.groups[id]
        table.insert(parts, ("G%s"):format(id))
        for _, s in ipairs(g.ScrollVelocities) do table.insert(parts, ("S%s:%s"):format(s.StartTime, s.Multiplier)) end
    end
    for _, l in ipairs(map.EditorLayers) do table.insert(parts, ("L%s"):format(l.Name)) end
    table.sort(parts)
    return table.concat(parts, " ")
end

function editor.noteCount() return #map.HitObjects end

function editor.qua()
    local lines = {
        "AudioFile: audio.mp3",
        "Title: " .. map.Title, "Artist: " .. map.Artist, "Creator: " .. map.Creator,
        "DifficultyName: " .. map.DifficultyName, "MapId: " .. map.MapId, "MapSetId: " .. map.MapSetId,
        "Mode: " .. map.Mode,
        "TimingPoints:",
    }
    for _, tp in ipairs(map.TimingPoints) do
        table.insert(lines, "- StartTime: " .. tp.StartTime)
        table.insert(lines, "  Bpm: " .. tp.Bpm)
    end
    table.insert(lines, "Bookmarks:")
    for _, bm in ipairs(map.Bookmarks) do
        table.insert(lines, "- StartTime: " .. bm.StartTime)
        table.insert(lines, "  Note: '" .. tostring(bm.Note):gsub("'", "''") .. "'")
    end
    table.insert(lines, "HitObjects:")
    for _, ho in ipairs(map.HitObjects) do
        table.insert(lines, "- StartTime: " .. ho.StartTime)
        table.insert(lines, "  Lane: " .. ho.Lane)
        if ho.EndTime > 0 then table.insert(lines, "  EndTime: " .. ho.EndTime) end
    end
    return table.concat(lines, "\n") .. "\n"
end

editor.clicks = {}

function editor.click(prefix) table.insert(editor.clicks, prefix) end

local function button(label)
    for i, prefix in ipairs(editor.clicks) do
        if tostring(label):sub(1, #prefix) == prefix then
            table.remove(editor.clicks, i)
            return true
        end
    end
    return false
end

editor.texts = {}

local lastText

local function text(t)
    lastText = tostring(t)
    table.insert(editor.texts, lastText)
end

imgui = setmetatable({
    SmallButton = button,
    Button = button,
    GetTime = function() return __now() / 1000 end,
    Text = text,
    TextColored = function(_, t) text(t) end,
    TextWrapped = text,
    IsItemClicked = function() return lastText ~= nil and button(lastText) end,
    Checkbox = function(label, value)
        if button(label) then return true, not value end
        return false, value
    end,
    IsMouseDown = function() return editor.mouseDown == true end,
}, { __index = function() return function() return false end end })
imgui_col = setmetatable({}, { __index = function() return 0 end })
imgui_style_var = setmetatable({}, { __index = function() return 0 end })

state = setmetatable({ SongTime = 0 }, {
    __index = function(_, key)
        if key == "UnixTime" then return __now() end
    end,
})

function print(kind, ...)
    local parts = { tostring(kind) }
    for _, v in ipairs({ ... }) do table.insert(parts, tostring(v)) end
    table.insert(editor.errors, table.concat(parts, " "))
end
