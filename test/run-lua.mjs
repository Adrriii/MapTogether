import fs from 'fs';
import { lua, lauxlib, lualib, to_luastring } from 'fengari';

const src = process.argv.slice(2).map(f => fs.readFileSync(f, 'utf8')).join('\n');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
	console.error(lua.lua_tojsstring(L, -1));
	process.exit(1);
}
