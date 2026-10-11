import fs from 'fs';
import yaml from 'js-yaml';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');

type State = unknown;

export class Lua {
	readonly L: State = lauxlib.luaL_newstate();

	constructor() {
		lualib.luaL_openlibs(this.L);
		this.register('__json_parse', ([text]) => JSON.parse(String(text)));
		this.register('__json_serialize', ([value]) => JSON.stringify(value));
		this.run('json = { parse = __json_parse, serialize = __json_serialize }');
	}

	run(code: string, name = 'chunk'): string | undefined {
		const status = lauxlib.luaL_loadbuffer(this.L, to_luastring(code), null, to_luastring(name));
		if (status !== lua.LUA_OK || lua.lua_pcall(this.L, 0, 0, 0) !== lua.LUA_OK) {
			const error = to_jsstring(lua.lua_tostring(this.L, -1));
			lua.lua_pop(this.L, 1);
			return error;
		}
		return;
	}

	get(expression: string): unknown {
		const error = this.run(`__result = ${expression}`);
		if (error) return { error };
		lua.lua_getglobal(this.L, to_luastring('__result'));
		const value = toJs(this.L, -1);
		lua.lua_pop(this.L, 1);
		return value;
	}

	register(name: string, fn: (args: unknown[]) => unknown, asQuaver = false): void {
		lua.lua_pushcfunction(this.L, (L: State) => {
			const args = [];
			for (let i = 1; i <= lua.lua_gettop(L); i++) args.push(toJs(L, i, asQuaver));
			const result = fn(args);
			if (result === undefined) return 0;
			toLua(L, result);
			return 1;
		});
		lua.lua_setglobal(this.L, to_luastring(name));
	}

	bindConfig(configPath: string, hooks: { failRead?: () => boolean; onWrite?: () => void } = {}): void {
		this.register('read', () => {
			if (hooks.failRead?.()) return null;
			try {
				return stringify(yaml.load(fs.readFileSync(configPath, 'utf8')));
			} catch {
				return null;
			}
		});
		this.register('write', ([value]) => {
			hooks.onWrite?.();
			fs.writeFileSync(configPath, yaml.dump(value ?? null), 'utf8');
			return undefined;
		}, true);
	}
}

const stringify = (value: unknown): unknown => {
	if (value === null || value === undefined) return null;
	if (Array.isArray(value)) return value.map(stringify);
	if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stringify(v)]));
	return String(value);
};

const toJs = (L: State, index: number, asQuaver = false): unknown => {
	switch (lua.lua_type(L, index)) {
		case lua.LUA_TBOOLEAN: return lua.lua_toboolean(L, index);
		case lua.LUA_TNUMBER: return lua.lua_tonumber(L, index);
		case lua.LUA_TSTRING: return to_jsstring(lua.lua_tostring(L, index));
		case lua.LUA_TTABLE: {
			if (lauxlib.luaL_getmetafield(L, index, to_luastring('__tostring')) !== lua.LUA_TNIL) {
				lua.lua_pop(L, 1);
				const name = to_jsstring(lauxlib.luaL_tolstring(L, index));
				lua.lua_pop(L, 1);
				return name;
			}
			const abs = lua.lua_absindex(L, index);
			const entries: [unknown, unknown][] = [];
			lua.lua_pushnil(L);
			while (lua.lua_next(L, abs) !== 0) {
				entries.push([toJs(L, -2), toJs(L, -1, asQuaver)]);
				lua.lua_pop(L, 1);
			}
			if (entries.length === 0) return asQuaver ? [null] : [];
			if (entries.every(([k], i) => k === i + 1)) return entries.map(([, v]) => v);
			return Object.fromEntries(entries.map(([k, v]) => [String(k), v]));
		}
		default: return null;
	}
};

const toLua = (L: State, value: unknown): void => {
	if (value === null || value === undefined) return lua.lua_pushnil(L);
	if (typeof value === 'boolean') return lua.lua_pushboolean(L, value);
	if (typeof value === 'number') return (value | 0) === value ? lua.lua_pushinteger(L, value) : lua.lua_pushnumber(L, value);
	if (Array.isArray(value)) {
		lua.lua_createtable(L, value.length, 0);
		value.forEach((v, i) => {
			toLua(L, v);
			lua.lua_rawseti(L, -2, i + 1);
		});
		return;
	}
	if (typeof value === 'object') {
		lua.lua_createtable(L, 0, 0);
		for (const [k, v] of Object.entries(value)) {
			toLua(L, v);
			lua.lua_setfield(L, -2, to_luastring(k));
		}
		return;
	}
	lua.lua_pushstring(L, to_luastring(String(value)));
};
