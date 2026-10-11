local Marker = {
    PREFIX  = "__MAP_FINDER__:"
}
do
    local function _generateSecret()
        return math.floor(state.UnixTime or 0)
    end

    function Marker.add()
        -- Remove any stale MT markers from previous sessions
        Marker.remove()

        local secret = _generateSecret();
        local name = Marker.PREFIX .. secret
        Perform.AddBookmark(utils.CreateBookmark(0, name))
        actions.Perform(utils.CreateEditorAction(action_type.ChangeBookmarkOffsetBatch, {}, 0))
        Companion.mapMarkerReady(secret)
    end

    function Marker.remove()
        for _, bm in ipairs(map.Bookmarks) do
            if tostring(bm.Note or ""):sub(1, #Marker.PREFIX) == Marker.PREFIX then
                Perform.RemoveBookmark(bm)
                break
            end
        end
    end
end
