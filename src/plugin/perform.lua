
local Perform = {}

do
	local DEFAULT_GROUP = "$Default"
	local HASH_MODULUS  = 2147483647
	local GLOBAL_GROUP  = "$Global"
	local HIT_SOUNDS    = { Normal = 1, Whistle = 2, Finish = 4, Clap = 8 }

	local _typeName, _fieldsOf, _encodeField, _groupId, _decodeField, _locate, _lowerBound, _reverse
	local _layersDiffer, _rebuildLayers, _syncGroups, _performIfAny, _newAll, _userBookmarks, _copy
	local _encodeObject, _fullKey, _mergeList, _collectWindows, _inWindow, _deepCopy
	local _layerIndex, _rewrite, _mirrored, _colorFields, _regroup, _enum, _hitSounds, _ownerGroup

	local function _perform(editorAction)
		if not editorAction then return end
		actions.PerformSilently(editorAction)
	end

	-- ── Object kinds ─────────────────────────────────────────────────────────

	local function _timeKey(time)
		return string.format("%.3f", tonumber(time) or 0)
	end

	local function _groupList(id, field)
		local group = map.GetTimingGroup(id or DEFAULT_GROUP)
		if not group then return {} end
		return group[field]
	end

	local KINDS
	KINDS = {
		HitObject = {
			fields = { "StartTime", "Lane", "EndTime", "HitSound", "EditorLayer", "Type", "TimingGroup" },
			new  = function(data) return Perform.hitObject(data) end,
			list = function() return map.HitObjects end,
			key  = function(item) return _timeKey(item.StartTime) .. ":" .. math.floor(tonumber(item.Lane) or 0) end,
		},
		TimingPoint = {
			fields = { "StartTime", "Bpm", "Signature", "Hidden" },
			new = function(data)
				return utils.CreateTimingPoint(tonumber(data.StartTime) or 0, tonumber(data.Bpm) or 0,
					_enum(time_signature, data.Signature, "Quadruple"), data.Hidden == true or data.Hidden == "true")
			end,
			list = function() return map.TimingPoints end,
			key  = function(item) return _timeKey(item.StartTime) end,
		},
		ScrollVelocity = {
			fields = { "StartTime", "Multiplier" },
			new    = function(data)
				return utils.CreateScrollVelocity(tonumber(data.StartTime) or 0, tonumber(data.Multiplier) or 1)
			end,
			list   = function(a) return _groupList(a.ScrollGroup, "ScrollVelocities") end,
			key    = function(item) return _timeKey(item.StartTime) end,
		},
		ScrollSpeedFactor = {
			fields = { "StartTime", "Multiplier" },
			new    = function(data)
				return utils.CreateScrollSpeedFactor(tonumber(data.StartTime) or 0, tonumber(data.Multiplier) or 1)
			end,
			list   = function(a) return _groupList(a.ScrollGroup, "ScrollSpeedFactors") end,
			key    = function(item) return _timeKey(item.StartTime) end,
		},
		Bookmark = {
			fields = { "StartTime", "Note", "ColorRgb" },
			new    = function(data)
				return utils.CreateBookmark(math.floor(tonumber(data.StartTime) or 0), tostring(data.Note or ""), data.ColorRgb)
			end,
			list   = function() return map.Bookmarks end,
			key    = function(item) return _timeKey(item.StartTime) .. ":" .. tostring(item.Note or "") end,
		},
		Layer = {
			fields   = { "Name", "Hidden", "ColorRgb" },
			empty    = { Index = 0 },
			decorate = function(layer, data) data.Index = _layerIndex(layer) end,
			new      = function(data)
				return utils.CreateEditorLayer(tostring(data.Name or ""), data.Hidden == true or data.Hidden == "true", data.ColorRgb)
			end,
			find     = function(item)
				local index = tonumber(item.Index) or 0
				if index == 0 then return map.DefaultLayer end
				return map.EditorLayers[index]
			end,
		},
		TimingGroup = {
			fields   = { "InitialScrollVelocity", "ColorRgb" },
			decorate = function(group, data)
				data.ScrollVelocities = {}
				for _, sv in ipairs(group.ScrollVelocities) do
					table.insert(data.ScrollVelocities, _encodeObject(KINDS.ScrollVelocity, sv))
				end
			end,
			new      = function(data)
				return utils.CreateScrollGroup(_newAll(KINDS.ScrollVelocity, data.ScrollVelocities),
					tonumber(data.InitialScrollVelocity) or 1, data.ColorRgb)
			end,
		},
	}

	local FIELDS = {
		HitObject          = { kind = KINDS.HitObject },
		HitObjects         = { kind = KINDS.HitObject, many = true },
		TimingPoint        = { kind = KINDS.TimingPoint },
		TimingPoints       = { kind = KINDS.TimingPoint, many = true },
		ScrollVelocity     = { kind = KINDS.ScrollVelocity },
		ScrollVelocities   = { kind = KINDS.ScrollVelocity, many = true },
		ScrollSpeedFactor  = { kind = KINDS.ScrollSpeedFactor },
		ScrollSpeedFactors = { kind = KINDS.ScrollSpeedFactor, many = true },
		Bookmark           = { kind = KINDS.Bookmark },
		Bookmarks          = { kind = KINDS.Bookmark, many = true },
		ChildHitObjects    = { kind = KINDS.HitObject, many = true },
		HitObjectsInLayer  = { kind = KINDS.HitObject, many = true },
		Layer              = { kind = KINDS.Layer },
		TimingGroup        = { kind = KINDS.TimingGroup },
	}

	local STRING_FIELDS = {
		NewNote = true, OldNote = true, Name = true, Previous = true,
		Id = true, OldId = true, NewId = true, TimingGroupId = true,
	}
	local BOOL_FIELDS   = { NewHidden = true, OriginalHidden = true }
	local ENUM_FIELDS   = {
		Sound        = function(value) return _hitSounds(value) end,
		NewSignature = function(value) return _enum(time_signature, value) end,
	}

	-- ── Action specs ─────────────────────────────────────────────────────────

	local function _swap(f1, f2)
		return function(a)
			a[f1], a[f2] = a[f2], a[f1]
			return a
		end
	end

	local function _negate(...)
		local fields = { ... }
		return function(a)
			for _, f in ipairs(fields) do a[f] = -(tonumber(a[f]) or 0) end
			return a
		end
	end

	local function _same(a) return a end

	local function _shift(field)
		return function(a)
			for _, item in ipairs(a[field] or {}) do
				item.StartTime = (tonumber(item.StartTime) or 0) - (tonumber(a.Offset) or 0)
			end
		end
	end

	local SPECS = {
		PlaceHitObject       = { args = { "HitObject" }, new = true, inverse = "RemoveHitObject" },
		RemoveHitObject      = { args = { "HitObject" }, inverse = "PlaceHitObject" },
		PlaceHitObjectBatch  = { args = { "HitObjects" }, new = true, inverse = "RemoveHitObjectBatch" },
		RemoveHitObjectBatch = { args = { "HitObjects" }, inverse = "PlaceHitObjectBatch" },
		ResizeLongNote       = { args = { "HitObject", "OriginalTime", "NewTime" }, inverse = _swap("OriginalTime", "NewTime") },
		AddHitsound          = { args = { "HitObjects", "Sound" }, inverse = "RemoveHitsound" },
		RemoveHitsound       = { args = { "HitObjects", "Sound" }, inverse = "AddHitsound" },
		MoveHitObjects       = {
			args    = { "HitObjects", "LaneOffset", "DragOffset" },
			inverse = _negate("LaneOffset", "DragOffset"),
			before  = function(a)
				for _, ho in ipairs(a.HitObjects) do
					ho.StartTime = (tonumber(ho.StartTime) or 0) - (tonumber(a.DragOffset) or 0)
					ho.Lane      = (tonumber(ho.Lane) or 0) - (tonumber(a.LaneOffset) or 0)
				end
			end,
		},
		FlipHitObjects       = {
			args    = { "HitObjects" },
			inverse = _same,
			before  = function(a)
				local keys = map.GetKeyCount()
				for _, ho in ipairs(a.HitObjects) do ho.Lane = keys - (tonumber(ho.Lane) or 0) + 1 end
			end,
		},
		SwapLanes            = {
			args    = { "HitObjects", "SwapLane1", "SwapLane2" },
			inverse = _same,
			before  = function(a)
				local l1, l2 = tonumber(a.SwapLane1), tonumber(a.SwapLane2)
				for _, ho in ipairs(a.HitObjects) do
					local lane = tonumber(ho.Lane)
					if lane == l1 then ho.Lane = l2 elseif lane == l2 then ho.Lane = l1 end
				end
			end,
		},

		AddTimingPoint                  = { args = { "TimingPoint" }, new = true, inverse = "RemoveTimingPoint" },
		RemoveTimingPoint               = { args = { "TimingPoint" }, inverse = "AddTimingPoint" },
		AddTimingPointBatch             = { args = { "TimingPoints" }, new = true, inverse = "RemoveTimingPointBatch" },
		RemoveTimingPointBatch          = { args = { "TimingPoints" }, inverse = "AddTimingPointBatch" },
		ChangeTimingPointBpm            = { args = { "TimingPoint", "NewBpm" }, extra = { "OriginalBpm" }, inverse = _swap("NewBpm", "OriginalBpm") },
		ChangeTimingPointHidden         = { args = { "TimingPoint", "NewHidden" }, extra = { "OriginalHidden" }, inverse = _swap("NewHidden", "OriginalHidden") },
		ChangeTimingPointSignature      = { args = { "TimingPoint", "NewSignature" }, extra = { "OriginalSignature" }, inverse = _swap("NewSignature", "OriginalSignature") },
		ChangeTimingPointOffset         = {
			args    = { "TimingPoint", "NewOffset" },
			extra   = { "OriginalOffset" },
			inverse = _swap("NewOffset", "OriginalOffset"),
			before  = function(a) a.TimingPoint.StartTime = a.OriginalOffset end,
		},
		ChangeTimingPointOffsetBatch    = { args = { "TimingPoints", "Offset" }, inverse = _negate("Offset"), before = _shift("TimingPoints") },
		ChangeTimingPointBpmBatch       = {
			args   = { "TimingPoints" },
			encode = function(a) return Perform.perItem(a, "TimingPoints", "TimingPoint", "ChangeTimingPointBpm", "NewBpm", "Bpm") end,
		},
		ChangeTimingPointSignatureBatch = {
			args    = { "TimingPoints", "NewSignature" },
			extra   = { "OriginalSignatures" },
			inverse = function(a)
				local inner = {}
				for i, tp in ipairs(a.TimingPoints) do
					table.insert(inner, { Type = "ChangeTimingPointSignature", TimingPoint = tp, NewSignature = a.OriginalSignatures[i] })
				end
				return { Type = "Batch", EditorActions = inner }
			end,
		},

		AddScrollVelocityBatch              = { args = { "ScrollVelocities", "ScrollGroup" }, new = true, inverse = "RemoveScrollVelocityBatch" },
		RemoveScrollVelocityBatch           = { args = { "ScrollVelocities", "ScrollGroup" }, inverse = "AddScrollVelocityBatch" },
		ChangeScrollVelocityOffsetBatch     = {
			args    = { "ScrollVelocities", "Offset" },
			group   = "ScrollVelocities",
			inverse = _negate("Offset"),
			before  = _shift("ScrollVelocities"),
		},
		ChangeScrollVelocityMultiplierBatch = {
			args    = { "ScrollVelocities", "Multiplier" },
			group   = "ScrollVelocities",
			inverse = function(a)
				return Perform.perItem(a, "ScrollVelocities", "ScrollVelocities", "ChangeScrollVelocityMultiplierBatch", "Multiplier", "Multiplier")
			end,
		},
		AddScrollSpeedFactor                = { args = { "ScrollSpeedFactor", "ScrollGroup" }, new = true, inverse = "RemoveScrollSpeedFactor" },
		RemoveScrollSpeedFactor             = { args = { "ScrollSpeedFactor", "ScrollGroup" }, inverse = "AddScrollSpeedFactor" },
		AddScrollSpeedFactorBatch           = { args = { "ScrollSpeedFactors", "ScrollGroup" }, new = true, inverse = "RemoveScrollSpeedFactorBatch" },
		RemoveScrollSpeedFactorBatch        = { args = { "ScrollSpeedFactors", "ScrollGroup" }, inverse = "AddScrollSpeedFactorBatch" },

		AddBookmark               = { args = { "Bookmark" }, new = true, inverse = "RemoveBookmark" },
		RemoveBookmark            = { args = { "Bookmark" }, inverse = "AddBookmark" },
		AddBookmarkBatch          = { args = { "Bookmarks" }, new = true, inverse = "RemoveBookmarkBatch" },
		RemoveBookmarkBatch       = { args = { "Bookmarks" }, inverse = "AddBookmarkBatch" },
		ChangeBookmarkOffsetBatch = { args = { "Bookmarks", "Offset" }, inverse = _negate("Offset"), before = _shift("Bookmarks") },
		EditBookmark              = {
			args    = { "Bookmark", "NewNote" },
			extra   = { "OldNote" },
			inverse = _swap("NewNote", "OldNote"),
			before  = function(a) a.Bookmark.Note = a.OldNote end,
		},

		ResnapHitObjects = {
			args   = {},
			encode = function(_, action, undo)
				local before, after = {}, {}
				for ho, adjustment in pairs(action.NoteTimeAdjustments) do
					local old, new = _encodeObject(KINDS.HitObject, ho), _encodeObject(KINDS.HitObject, ho)
					old.StartTime, old.EndTime = adjustment.OriginalStartTime, adjustment.OriginalEndTime
					new.StartTime, new.EndTime = adjustment.NewStartTime, adjustment.NewEndTime
					table.insert(before, old)
					table.insert(after, new)
				end
				if undo then return _rewrite(after, before) end
				return _rewrite(before, after)
			end,
		},
		ReverseHitObjects = {
			args   = { "HitObjects" },
			encode = function(a) return _rewrite(_mirrored(a.HitObjects), a.HitObjects) end,
		},

		RenameLayer           = { args = { "Layer", "Name" }, extra = { "Previous" }, inverse = _swap("Name", "Previous") },
		ToggleLayerVisibility = { args = { "Layer" }, inverse = _same },
		ColorLayer            = {
			args   = { "Layer", "R", "G", "B" },
			read   = { "Layer" },
			encode = function(a) return _colorFields(a, a.Layer.ColorRgb) end,
		},
		MoveToLayer           = {
			args    = { "Layer", "HitObjects" },
			extra   = { "OriginalLayers" },
			inverse = function(a)
				return _regroup(a.HitObjects, a.OriginalLayers, function(index, hos)
					return { Type = "MoveToLayer", Layer = { Index = index }, HitObjects = hos }
				end)
			end,
		},

		CreateTimingGroup        = {
			args    = { "Id", "TimingGroup", "ChildHitObjects" },
			new     = { TimingGroup = true },
			inverse = function(a) return { Type = "RemoveTimingGroup", Id = a.Id } end,
		},
		RemoveTimingGroup        = {
			args    = { "Id" },
			extra   = { "TimingGroup", "ChildHitObjects" },
			inverse = function(a)
				return { Type = "CreateTimingGroup", Id = a.Id, TimingGroup = a.TimingGroup, ChildHitObjects = a.ChildHitObjects }
			end,
		},
		RenameTimingGroup        = { args = { "OldId", "NewId" }, inverse = _swap("OldId", "NewId") },
		MoveObjectsToTimingGroup = {
			args    = { "HitObjects", "TimingGroupId" },
			extra   = { "OriginalTimingGroupIds" },
			inverse = function(a)
				return _regroup(a.HitObjects, a.OriginalTimingGroupIds, function(id, hos)
					return { Type = "MoveObjectsToTimingGroup", HitObjects = hos, TimingGroupId = id }
				end)
			end,
		},
		ColorTimingGroup         = {
			args   = { "Id", "R", "G", "B" },
			read   = {},
			encode = function(a, action)
				a.Id = _groupId(action.TimingGroup)
				return _colorFields(a, action.TimingGroup.ColorRgb)
			end,
		},

		ChangePreviewTime = { args = { "Time" }, extra = { "OriginalTime" }, inverse = _swap("Time", "OriginalTime") },
		ApplyOffset       = { args = { "Offset" }, inverse = _negate("Offset") },
	}

	local ALIASES = {
		AddScrollVelocity    = { type = "AddScrollVelocityBatch", from = "ScrollVelocity", to = "ScrollVelocities" },
		RemoveScrollVelocity = { type = "RemoveScrollVelocityBatch", from = "ScrollVelocity", to = "ScrollVelocities" },
	}

	-- ── Sending ──────────────────────────────────────────────────────────────

	function Perform.encode(action, undo)
		local name = _typeName(action.Type)
		if name == "Batch" then
			local inner = {}
			for _, child in ipairs(action.EditorActions) do
				local encoded, unsupported = Perform.encode(child, undo)
				if not encoded then return nil, unsupported end
				table.insert(inner, encoded)
			end
			if undo then _reverse(inner) end
			return { Type = "Batch", EditorActions = inner }
		end

		local alias = ALIASES[name]
		local spec = SPECS[alias and alias.type or name]
		if not spec then return nil, name end

		local a = { Type = alias and alias.type or name }
		for _, field in ipairs(spec.read or _fieldsOf(spec)) do
			local source = alias and field == alias.to and alias.from or field
			a[field] = _encodeField(action, source)
		end
		if alias then a[alias.to] = { a[alias.to] } end
		if spec.group then a.ScrollGroup = _ownerGroup(spec.group, action[spec.group]) end

		if spec.encode then return spec.encode(a, action, undo) end
		if not undo then return a end
		if type(spec.inverse) == "string" then
			a.Type = spec.inverse
			return a
		end
		return spec.inverse(a)
	end

	function Perform.reshaped(sent, live)
		local now = _encodeObject(KINDS.HitObject, live)
		if _fullKey(KINDS.HitObject, now) == _fullKey(KINDS.HitObject, sent) then return end
		return _rewrite({ sent }, { now })
	end

	-- ── Receiving ────────────────────────────────────────────────────────────

	function Perform.apply(a)
		if a.Type == "Batch" then
			for _, inner in ipairs(a.EditorActions or {}) do Perform.apply(inner) end
			return
		end

		local spec = SPECS[a.Type]
		if not spec then return end
		if a.ScrollGroup == nil then a.ScrollGroup = DEFAULT_GROUP end
		if spec.before then spec.before(a) end

		local args = {}
		for i, field in ipairs(spec.args) do
			local value = _decodeField(a, field, spec.new)
			if value == nil then return end
			args[i] = value
		end
		_perform(utils.CreateEditorAction(action_type[a.Type], table.unpack(args, 1, #spec.args)))
	end

	function Perform.replay(list)
		for _, a in ipairs(list) do Perform.apply(_deepCopy(a)) end
	end

	function Perform.hitObject(HitObject)
		return utils.CreateHitObject(
			math.floor(tonumber(HitObject.StartTime)   or 0),
			math.floor(tonumber(HitObject.Lane)        or 1),
			math.floor(tonumber(HitObject.EndTime)     or 0),
			_hitSounds(HitObject.HitSound),
			math.floor(tonumber(HitObject.EditorLayer) or 0),
			_enum(hitobject_type, HitObject.Type, "Normal"),
			HitObject.TimingGroup or DEFAULT_GROUP
		)
	end

	function Perform.perItem(a, listField, itemField, itemType, valueField, sourceField)
		local inner = {}
		for _, item in ipairs(a[listField]) do
			local single = { Type = itemType, ScrollGroup = a.ScrollGroup }
			single[itemField] = FIELDS[itemField].many and { item } or item
			single[valueField] = item[sourceField]
			table.insert(inner, single)
		end
		return { Type = "Batch", EditorActions = inner }
	end

	-- ── Snapshots ────────────────────────────────────────────────────────────

	function Perform.snapshot()
		local snap = {
			hitObjects   = _pack(KINDS.HitObject, map.HitObjects),
			timingPoints = _pack(KINDS.TimingPoint, map.TimingPoints),
			bookmarks    = _pack(KINDS.Bookmark, _userBookmarks()),
			layers       = {},
			groups       = {},
		}
		for _, layer in ipairs(map.EditorLayers) do
			table.insert(snap.layers, { Name = layer.Name, Hidden = layer.Hidden, ColorRgb = layer.ColorRgb })
		end
		for _, id in ipairs(map.GetTimingGroupIds()) do
			local group = map.GetTimingGroup(id)
			table.insert(snap.groups, {
				id                    = id,
				InitialScrollVelocity = group.InitialScrollVelocity,
				ColorRgb              = group.ColorRgb,
				svs                   = _pack(KINDS.ScrollVelocity, group.ScrollVelocities),
				sfs                   = _pack(KINDS.ScrollSpeedFactor, group.ScrollSpeedFactors),
			})
		end
		return snap
	end

	function Perform.unpack(snap)
		local groups = {}
		for i, entry in ipairs(snap.groups or {}) do
			local copy = {}
			for k, v in pairs(entry) do copy[k] = v end
			copy.svs = _unpack(KINDS.ScrollVelocity, entry.svs)
			copy.sfs = _unpack(KINDS.ScrollSpeedFactor, entry.sfs)
			groups[i] = copy
		end
		local unpacked = {}
		for k, v in pairs(snap) do unpacked[k] = v end
		unpacked.hitObjects   = _unpack(KINDS.HitObject, snap.hitObjects)
		unpacked.timingPoints = _unpack(KINDS.TimingPoint, snap.timingPoints)
		unpacked.bookmarks    = _unpack(KINDS.Bookmark, snap.bookmarks)
		unpacked.groups       = groups
		return unpacked
	end

	function Perform.applySnapshot(snap)
		snap = Perform.unpack(snap)
		if _layersDiffer(snap.layers or {}) then _rebuildLayers(snap.layers or {}) end
		_syncGroups(snap.groups or {})
		Perform.merge(snap, { all = true }, {})
	end

	function Perform.countRemovedNotes(batch)
		local count = 0
		for _, a in ipairs(batch.EditorActions or {}) do
			if a.Type == "RemoveHitObjectBatch" then count = count + #a.HitObjects end
		end
		return count
	end

	-- ── Consistency ──────────────────────────────────────────────────────────

	function Perform.hash()
		local sections = { { count = 0, sum = 0 }, { count = 0, sum = 0 }, { count = 0, sum = 0 } }
		local function add(kind, ...)
			local h = kind
			for _, value in ipairs({ ... }) do h = (h * 31 + _milli(value)) % HASH_MODULUS end
			local section = sections[kind]
			section.count = section.count + 1
			section.sum = (section.sum + h) % HASH_MODULUS
		end
		local notes, M = sections[1], HASH_MODULUS
		for _, ho in ipairs(map.HitObjects) do
			local h = (31 + ho.StartTime * 1000) % M
			h = (h * 31 + ho.Lane * 1000) % M
			h = (h * 31 + ho.EndTime * 1000) % M
			h = (h * 31 + ho.EditorLayer * 1000) % M
			h = (h * 31 + (tostring(ho.Type) == "Mine" and 1000 or 0)) % M
			notes.count = notes.count + 1
			notes.sum = (notes.sum + h) % M
		end
		for _, tp in ipairs(map.TimingPoints) do add(2, tp.StartTime, tp.Bpm) end
		for _, id in ipairs(map.GetTimingGroupIds()) do
			for _, sv in ipairs(map.GetTimingGroup(id).ScrollVelocities) do add(3, sv.StartTime, sv.Multiplier) end
		end
		local parts = {}
		for i, section in ipairs(sections) do parts[i] = section.count .. ":" .. section.sum end
		return "h" .. table.concat(parts, "-")
	end

	-- ── Merging ──────────────────────────────────────────────────────────────

	function Perform.touch(a, windows)
		if a.Type == "Batch" then
			for _, inner in ipairs(a.EditorActions or {}) do Perform.touch(inner, windows) end
			return
		end
		if a.Type == "ApplyOffset" then
			windows.all = true
			return
		end

		_collectWindows(a, windows)
		local spec = SPECS[a.Type]
		if not spec or not spec.before then return end
		local copy = _deepCopy(a)
		spec.before(copy)
		_collectWindows(copy, windows)
	end

	function Perform.windowList(windows)
		local list = {}
		for window in pairs(windows) do
			if type(window) == "number" then table.insert(list, window) end
		end
		table.sort(list)
		return { all = windows.all == true, windows = list }
	end

	function Perform.windowSet(encoded)
		local windows = {}
		if type(encoded) ~= "table" then return windows end
		windows.all = encoded.all == true or encoded.all == "true"
		for _, window in ipairs(encoded.windows or {}) do
			local n = tonumber(window)
			if n then windows[n] = true end
		end
		return windows
	end

	function Perform.resumeConflicts(own, host)
		if own.all then return host end
		if host.all then return { all = true } end
		local except = {}
		for window in pairs(own) do
			if type(window) == "number" and not host[window] then except[window] = true end
		end
		return { all = true, except = except }
	end

	function Perform.merge(snap, conflicts, own)
		snap = Perform.unpack(snap)
		local outgoing = {}
		local function merge(kind, live, items, field, addType, removeType, groupId)
			_mergeList(kind, live, items, { field = field, add = addType, remove = removeType, group = groupId },
				conflicts, own, outgoing)
		end

		merge(KINDS.HitObject, map.HitObjects, snap.hitObjects, "HitObjects", "PlaceHitObjectBatch", "RemoveHitObjectBatch")
		merge(KINDS.TimingPoint, map.TimingPoints, snap.timingPoints, "TimingPoints", "AddTimingPointBatch", "RemoveTimingPointBatch")
		merge(KINDS.Bookmark, _userBookmarks(), snap.bookmarks, "Bookmarks", "AddBookmarkBatch", "RemoveBookmarkBatch")
		for _, entry in ipairs(snap.groups or {}) do
			local group = map.GetTimingGroup(entry.id)
			if group then
				merge(KINDS.ScrollVelocity, group.ScrollVelocities, entry.svs, "ScrollVelocities",
					"AddScrollVelocityBatch", "RemoveScrollVelocityBatch", entry.id)
				merge(KINDS.ScrollSpeedFactor, group.ScrollSpeedFactors, entry.sfs, "ScrollSpeedFactors",
					"AddScrollSpeedFactorBatch", "RemoveScrollSpeedFactorBatch", entry.id)
			end
		end
		return { Type = "Batch", EditorActions = outgoing }
	end

	-- ── Local editor actions ─────────────────────────────────────────────────

	function Perform.PlaceNote(ho)
		if not ho then return end
		_perform(utils.CreateEditorAction(action_type.PlaceHitObject, ho))
		return ho
	end

	function Perform.PlaceNotesBatch(list)
		if not list or #list == 0 then return end
		_perform(utils.CreateEditorAction(action_type.PlaceHitObjectBatch, list))
	end

	function Perform.RemoveNote(hitObject)
		if not hitObject then return end
		_perform(utils.CreateEditorAction(action_type.RemoveHitObject, hitObject))
	end

	function Perform.RemoveNotesBatch(list)
		if not list or #list == 0 then return end
		_perform(utils.CreateEditorAction(action_type.RemoveHitObjectBatch, list))
	end

	function Perform.AddBookmark(bookmark)
		_perform(utils.CreateEditorAction(action_type.AddBookmark, bookmark))
		return bookmark
	end

	function Perform.RemoveBookmark(bookmark)
		if not bookmark then return end
		_perform(utils.CreateEditorAction(action_type.RemoveBookmark, bookmark))
	end

	function Perform.MoveBookmark(bookmark, offset)
		_perform(utils.CreateEditorAction(action_type.ChangeBookmarkOffsetBatch, { bookmark }, offset))
	end

	-- ── Helpers ──────────────────────────────────────────────────────────────

	function _layersDiffer(layers)
		local live = map.EditorLayers
		if #live ~= #layers then return true end
		for i, layer in ipairs(layers) do
			local current = _encodeObject(KINDS.Layer, live[i])
			current.Index = nil
			local wanted = _deepCopy(layer)
			wanted.Index = nil
			if _fullKey(KINDS.Layer, current) ~= _fullKey(KINDS.Layer, wanted) then return true end
		end
		return false
	end

	function _rebuildLayers(layers)
		for _, layer in ipairs(_copy(map.EditorLayers)) do
			_perform(utils.CreateEditorAction(action_type.RemoveLayer, layer))
		end
		for _, layer in ipairs(layers) do
			_perform(utils.CreateEditorAction(action_type.CreateLayer, KINDS.Layer.new(layer)))
		end
	end

	function _syncGroups(groups)
		local wanted = {}
		for _, entry in ipairs(groups) do wanted[entry.id] = entry end

		for _, id in ipairs(_copy(map.GetTimingGroupIds())) do
			if not wanted[id] and id ~= DEFAULT_GROUP and id ~= GLOBAL_GROUP then
				_perform(utils.CreateEditorAction(action_type.RemoveTimingGroup, id))
			end
		end

		for _, entry in ipairs(groups) do
			local group = map.GetTimingGroup(entry.id)
			if not group then
				local created = utils.CreateScrollGroup(_newAll(KINDS.ScrollVelocity, entry.svs),
					tonumber(entry.InitialScrollVelocity) or 1, entry.ColorRgb)
				_perform(utils.CreateEditorAction(action_type.CreateTimingGroup, entry.id, created, {}))
			elseif entry.ColorRgb and tostring(group.ColorRgb) ~= tostring(entry.ColorRgb) then
				local color = _colorFields({}, entry.ColorRgb)
				_perform(utils.CreateEditorAction(action_type.ColorTimingGroup, entry.id, color.R, color.G, color.B))
			end
		end
	end

	function _encodeObject(kind, obj)
		local data = {}
		for _, field in ipairs(kind.fields) do data[field] = obj[field] end
		if kind.decorate then kind.decorate(obj, data) end
		return data
	end

	function _fullKey(kind, item)
		local parts = {}
		for _, field in ipairs(kind.fields) do
			local value = tostring(item[field])
			local n = tonumber(value)
			table.insert(parts, n and string.format("%.3f", n) or value)
		end
		return table.concat(parts, "|")
	end

	function _mergeList(kind, live, items, target, conflicts, own, outgoing)
		local remaining = {}
		for _, item in ipairs(items or {}) do
			local key = _fullKey(kind, item)
			remaining[key] = (remaining[key] or 0) + 1
		end

		local revertAdds, revertRemoves, sendAdds, sendRemoves = {}, {}, {}, {}
		for _, obj in ipairs(_copy(live)) do
			local data = _encodeObject(kind, obj)
			local key = _fullKey(kind, data)
			if (remaining[key] or 0) > 0 then
				remaining[key] = remaining[key] - 1
			elseif not _inWindow(own, data) then
				if _inWindow(conflicts, data) then table.insert(revertRemoves, obj) else table.insert(sendAdds, data) end
			end
		end

		for _, item in ipairs(items or {}) do
			local key = _fullKey(kind, item)
			if (remaining[key] or 0) > 0 then
				remaining[key] = remaining[key] - 1
				if not _inWindow(own, item) then
					if _inWindow(conflicts, item) then table.insert(revertAdds, kind.new(item)) else table.insert(sendRemoves, item) end
				end
			end
		end

		local group = target.group and map.GetTimingGroup(target.group)
		_performIfAny(action_type[target.remove], revertRemoves, group)
		_performIfAny(action_type[target.add], revertAdds, group)
		if #sendRemoves > 0 then table.insert(outgoing, { Type = target.remove, [target.field] = sendRemoves, ScrollGroup = target.group }) end
		if #sendAdds > 0 then table.insert(outgoing, { Type = target.add, [target.field] = sendAdds, ScrollGroup = target.group }) end
	end

	function _collectWindows(a, windows)
		for field, def in pairs(FIELDS) do
			local value = a[field]
			if value then
				for _, item in ipairs(def.many and value or { value }) do
					if item.StartTime == nil then break end
					windows[math.floor((tonumber(item.StartTime) or 0) / 1000)] = true
					local endTime = tonumber(item.EndTime) or 0
					if endTime > 0 then windows[math.floor(endTime / 1000)] = true end
				end
			end
		end
	end

	function _inWindow(windows, item)
		local window = math.floor((tonumber(item.StartTime) or 0) / 1000)
		if windows.all then return not (windows.except and windows.except[window]) end
		return windows[window] == true
	end

	function _deepCopy(value)
		if type(value) ~= "table" then return value end
		local copy = {}
		for k, v in pairs(value) do copy[k] = _deepCopy(v) end
		return copy
	end

	function _layerIndex(layer)
		for i, l in ipairs(map.EditorLayers) do
			if l == layer then return i end
		end
		return 0
	end

	function _rewrite(before, after)
		local inner = {}
		if #before > 0 then table.insert(inner, { Type = "RemoveHitObjectBatch", HitObjects = before }) end
		if #after > 0 then table.insert(inner, { Type = "PlaceHitObjectBatch", HitObjects = after }) end
		return { Type = "Batch", EditorActions = inner }
	end

	function _mirrored(hos)
		local first, last = math.huge, -math.huge
		for _, ho in ipairs(hos) do
			local st, et = tonumber(ho.StartTime) or 0, tonumber(ho.EndTime) or 0
			first = math.min(first, st)
			last  = math.max(last, st, et)
		end
		local mirrored = {}
		for _, ho in ipairs(hos) do
			local copy = _deepCopy(ho)
			local st, et = tonumber(ho.StartTime) or 0, tonumber(ho.EndTime) or 0
			if et > 0 then
				copy.StartTime, copy.EndTime = first + last - et, first + last - st
			else
				copy.StartTime = first + last - st
			end
			table.insert(mirrored, copy)
		end
		return mirrored
	end

	function _colorFields(a, colorRgb)
		local r, g, b = tostring(colorRgb or ""):match("(%d+),(%d+),(%d+)")
		a.R, a.G, a.B = tonumber(r) or 255, tonumber(g) or 255, tonumber(b) or 255
		return a
	end

	function _regroup(items, keys, build)
		local groups, order = {}, {}
		for i, item in ipairs(items) do
			local key = keys[i]
			if key ~= nil then
				if not groups[key] then
					groups[key] = {}
					table.insert(order, key)
				end
				table.insert(groups[key], item)
			end
		end
		local inner = {}
		for _, key in ipairs(order) do table.insert(inner, build(key, groups[key])) end
		return { Type = "Batch", EditorActions = inner }
	end

	function _ownerGroup(field, items)
		for _, item in ipairs(items) do
			for _, id in ipairs(map.GetTimingGroupIds()) do
				for _, live in ipairs(map.GetTimingGroup(id)[field]) do
					if live == item then return id end
				end
			end
			return DEFAULT_GROUP
		end
		return DEFAULT_GROUP
	end

	function _performIfAny(actionType, list, ...)
		if #list == 0 then return end
		_perform(utils.CreateEditorAction(actionType, list, ...))
	end

	function _newAll(kind, items)
		local list = {}
		for _, item in ipairs(items or {}) do table.insert(list, kind.new(item)) end
		return list
	end

	function _userBookmarks()
		local list = {}
		for _, bm in ipairs(map.Bookmarks) do
			if tostring(bm.Note or ""):sub(1, #CFG.bookmarkPrefix) ~= CFG.bookmarkPrefix then table.insert(list, bm) end
		end
		return list
	end

	function _copy(list)
		local copy = {}
		for _, item in ipairs(list) do table.insert(copy, item) end
		return copy
	end

	function _typeName(actionType)
		if action_type.Batch == actionType then return "Batch" end
		for name in pairs(SPECS) do
			if action_type[name] == actionType then return name end
		end
		for name in pairs(ALIASES) do
			if action_type[name] == actionType then return name end
		end
		return tostring(actionType)
	end

	function _fieldsOf(spec)
		local fields = {}
		for _, f in ipairs(spec.args) do table.insert(fields, f) end
		for _, f in ipairs(spec.extra or {}) do table.insert(fields, f) end
		return fields
	end

	function _encodeField(action, field)
		local value = action[field]
		if field == "ScrollGroup" then return _groupId(value) end

		local def = FIELDS[field]
		if def and value == nil then return def.kind.empty end
		if def and def.many then
			local list = {}
			for _, item in ipairs(value) do table.insert(list, _encodeObject(def.kind, item)) end
			return list
		end
		if def then return _encodeObject(def.kind, value) end
		if type(value) ~= "table" then return value end

		local copy = {}
		for _, v in ipairs(value) do table.insert(copy, v) end
		return copy
	end

	function _enum(enumTable, value, default)
		if value == nil then return default and enumTable[default] end
		if type(value) ~= "string" then return value end
		return tonumber(value) or enumTable[value] or (default and enumTable[default])
	end

	function _hitSounds(value)
		if type(value) ~= "string" then return value or 0 end
		if tonumber(value) then return tonumber(value) end
		local total = 0
		for name in value:gmatch("%a+") do total = total + (HIT_SOUNDS[name] or 0) end
		return total
	end

	function _groupId(group)
		if not group then return DEFAULT_GROUP end
		for _, id in ipairs(map.GetTimingGroupIds()) do
			if map.GetTimingGroup(id) == group then return id end
		end
		return DEFAULT_GROUP
	end

	function _decodeField(a, field, new)
		local value = a[field]
		if field == "ScrollGroup" then return map.GetTimingGroup(value) end
		if STRING_FIELDS[field] then return value ~= nil and tostring(value) or nil end
		if BOOL_FIELDS[field] then return value == true or value == "true" end
		if ENUM_FIELDS[field] then return ENUM_FIELDS[field](value) end

		local def = FIELDS[field]
		if not def then return tonumber(value) end
		if value == nil then return end

		local items = def.many and value or { value }
		local decoded = {}
		if new == true or (type(new) == "table" and new[field]) then
			for _, item in ipairs(items) do table.insert(decoded, def.kind.new(item)) end
		elseif def.kind.find then
			for _, item in ipairs(items) do table.insert(decoded, def.kind.find(item)) end
		else
			decoded = _locate(def.kind, def.kind.list(a), items)
		end

		if not def.many then return decoded[1] end
		if #decoded == 0 and #items > 0 then return end
		return decoded
	end

	function _locate(kind, list, items)
		local wanted, first, last = {}, math.huge, -math.huge
		for _, item in ipairs(items) do
			wanted[kind.key(item)] = true
			local t = tonumber(item.StartTime) or 0
			first, last = math.min(first, t), math.max(last, t)
		end

		local found = {}
		if first == math.huge then return found end
		for i = _lowerBound(list, first), #list do
			local live = list[i]
			if live.StartTime > last + 0.001 then break end
			local key = kind.key(live)
			if wanted[key] then
				wanted[key] = nil
				table.insert(found, live)
			end
		end
		return found
	end

	function _lowerBound(list, time)
		local lo, hi = 1, #list + 1
		while lo < hi do
			local mid = math.floor((lo + hi) / 2)
			if list[mid].StartTime < time - 0.001 then lo = mid + 1 else hi = mid end
		end
		return lo
	end

	function _pack(kind, items)
		local lines = {}
		for i, item in ipairs(items) do
			local fields = {}
			for j, field in ipairs(kind.fields) do fields[j] = _escape(item[field]) end
			lines[i] = table.concat(fields, "|")
		end
		return table.concat(lines, "\n")
	end

	function _unpack(kind, packed)
		if type(packed) ~= "string" then return packed or {} end
		local items = {}
		for line in packed:gmatch("[^\n]+") do
			local item, i = {}, 0
			for value in (line .. "|"):gmatch("([^|]*)|") do
				i = i + 1
				local field = kind.fields[i]
				if field and value ~= "~" then
					item[field] = (value:gsub("%%(%x%x)", function(hex) return string.char(tonumber(hex, 16)) end))
				end
			end
			table.insert(items, item)
		end
		return items
	end

	function _escape(value)
		if value == nil then return "~" end
		return (tostring(value):gsub("[%%|~\r\n]", function(c) return string.format("%%%02X", c:byte()) end))
	end

	function _milli(value)
		local n = tonumber(value) or 0
		if n == math.floor(n) then return n * 1000 end
		return math.floor((tonumber(string.format("%.3f", n)) or 0) * 1000 + 0.5)
	end

	function _reverse(list)
		local n = #list
		for i = 1, math.floor(n / 2) do list[i], list[n - i + 1] = list[n - i + 1], list[i] end
	end
end
