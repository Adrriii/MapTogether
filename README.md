# MapTogether

Edit a [Quaver](https://github.com/Quaver/Quaver) map with friends, live. The notes, timing points and SVs you place show up in their editor, and theirs in yours.

To use it, subscribe to [MapTogether on the Steam Workshop](https://steamcommunity.com/sharedfiles/filedetails/?id=3816719266) and download the companion from [qmtg.rhythmgamers.net](https://qmtg.rhythmgamers.net).

## How it works

MapTogether has three parts:

- **Plugin** (`src/plugin`, Lua): runs inside Quaver's editor, sends your edits and applies everyone else's.
- **Companion** (`src/companion`, TypeScript): a small app next to Quaver. Quaver plugins can't open network connections, so the plugin talks to the companion through its `config.yaml` file (`src/quaver_ipc`), and the companion talks to the server. It also finds the map on disk, shows a status window in the browser and keeps itself and the plugin up to date.
- **Server** (`src/server`, TypeScript): relays edits between the companions of a session, orders them and helps late joiners catch up.

`src/shared` holds the types and protocol used by the companion and the server.

## Development

You need [Bun](https://bun.sh).

```bash
bun install
```

Build the plugin into `plugin.lua` and run the companion from source. Clone the repository into Quaver's `Plugins` folder so Quaver picks the plugin up:

```bash
bun run dev
```

Run a local server and point the companion at it:

```bash
bun run server
```

```bash
MT_SERVER=ws://localhost:7777 bun run dev
```

Run the checks:

```bash
bun run test
```

```bash
bun run typecheck
```

```bash
bun run lint
```

### Companion settings

| Variable | Effect |
|---|---|
| `MT_SERVER` | Server URL (default `wss://qmtg.rhythmgamers.net`) |
| `MT_SONGS_DIR` | Quaver `Songs` folder, when it can't be found on its own |
| `MT_NO_GUI` | Don't open the status window in the browser |
| `MT_GUI_PORT` | Port of the status window |
| `MT_NO_UPDATE` | Don't update the companion itself |
| `MT_NO_PLUGIN_UPDATE` | Don't update the plugin |

### Hosting a server

```bash
docker compose up -d
```

The server listens on port 7777 in the container, published on `MT_PORT` (default 24981).

## License

Copyright (C) 2026 Adrien Boitelle

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the [GNU Affero General Public License](LICENSE) for more details.

If you run a modified server, the AGPL asks you to offer its source code to the people who use it.

`intellisense.lua` comes from Emik and plummyyummy and is in the public domain.
