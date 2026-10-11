<?php
$workshopUrl = 'https://steamcommunity.com/sharedfiles/filedetails/?id=3816719266';

$latest = function (string $os): ?string {
    $dir = __DIR__ . "/releases/$os";
    if (!is_dir($dir)) return null;
    $versions = array_values(array_filter(scandir($dir), fn ($v) => preg_match('/^v\d+\.\d+\.\d+$/', $v)));
    if (!$versions) return null;
    usort($versions, 'version_compare');
    return end($versions);
};
$windows = $latest('windows');
$linux   = $latest('linux');
$version = $windows ?? $linux ?? '';
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MapTogether for Quaver</title>
<meta name="description" content="Edit a Quaver map with friends, live, right inside the editor.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Chakra+Petch:wght@500;700&display=swap" rel="stylesheet">
<style>
    :root {
        --page: #e9edf2;
        --ink: #17202b;
        --muted: #556070;
        --rule: #c9d1db;
        --field: #232834;
        --field-lane: #2b3140;
        --beat: #e5484d;
        --half: #4c8dff;
        --you: #f26666;
        --peer: #4fb8f0;
        --focus: #4c8dff;
    }

    * { box-sizing: border-box; }

    body {
        margin: 0;
        background: var(--page);
        color: var(--ink);
        font: 400 1.0625rem/1.6 "Atkinson Hyperlegible", system-ui, sans-serif;
    }

    a { color: inherit; text-underline-offset: 0.2em; }
    a:focus-visible, .download:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }

    h1, h2 {
        font-family: "Chakra Petch", system-ui, sans-serif;
        font-weight: 700;
        line-height: 1.1;
        margin: 0;
    }

    .page {
        max-width: 68rem;
        margin: 0 auto;
        padding: 3.5rem 1.25rem 3rem;
    }

    .hero {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 17rem;
        gap: 3.5rem;
        align-items: start;
    }

    h1 { font-size: clamp(2.75rem, 7vw, 4.75rem); letter-spacing: -0.02em; }

    .lede {
        font-size: 1.3rem;
        line-height: 1.5;
        max-width: 34ch;
        margin: 1.25rem 0 0;
    }

    .alpha {
        margin: 1.5rem 0 0;
        padding-left: 0.9rem;
        border-left: 3px solid var(--you);
        color: var(--muted);
        max-width: 46ch;
    }

    .downloads {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-top: 2rem;
    }

    .download {
        display: inline-flex;
        flex-direction: column;
        padding: 0.8rem 1.25rem;
        background: var(--ink);
        color: var(--page);
        border-radius: 0.4rem;
        text-decoration: none;
        font-family: "Chakra Petch", system-ui, sans-serif;
        font-weight: 700;
        font-size: 1.1rem;
        line-height: 1.2;
    }

    .download small {
        font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
        font-weight: 400;
        font-size: 0.85rem;
        opacity: 0.75;
    }

    .download:hover { background: #26323f; }

    .field {
        position: relative;
        height: 30rem;
        background: var(--field);
        border-radius: 0.5rem;
        overflow: hidden;
    }

    .lanes {
        position: absolute;
        inset: 0 1.25rem 0 4.25rem;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 2px;
    }

    .lanes span { background: var(--field-lane); }

    .line {
        position: absolute;
        left: 4.25rem;
        right: 1.25rem;
        height: 2px;
        background: var(--half);
        opacity: 0.55;
    }

    .line.beat { background: var(--beat); opacity: 0.8; }

    .receptor {
        position: absolute;
        left: 4.25rem;
        right: 1.25rem;
        bottom: 1.5rem;
        height: 3px;
        background: #e9edf2;
        opacity: 0.85;
    }

    .note {
        position: absolute;
        width: calc((100% - 5.5rem - 6px) / 4 - 0.5rem);
        height: 0.9rem;
        border-radius: 0.3rem;
        animation: place 0.25s ease-out both;
    }

    .note.long { height: auto; }
    .note.you { background: var(--you); }
    .note.peer { background: var(--peer); }

    .cursor {
        position: absolute;
        left: 0;
        width: 4rem;
        padding: 0.15rem 0.4rem;
        font-size: 0.75rem;
        font-weight: 700;
        line-height: 1.3;
        color: var(--field);
        border-radius: 0 0.25rem 0.25rem 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .cursor.you { background: var(--you); }
    .cursor.peer { background: var(--peer); }

    @keyframes place {
        from { opacity: 0; transform: scaleY(0.4); }
        to { opacity: 1; transform: none; }
    }

    section { margin-top: 4.5rem; max-width: 46rem; }

    h2 { font-size: 1.9rem; }

    .steps {
        list-style: none;
        counter-reset: step;
        padding: 0;
        margin: 1.5rem 0 0;
    }

    .steps li {
        counter-increment: step;
        position: relative;
        padding: 0 0 1.75rem 3.25rem;
    }

    .steps li::before {
        content: counter(step);
        position: absolute;
        left: 0;
        top: -0.1rem;
        width: 2.1rem;
        height: 2.1rem;
        display: grid;
        place-items: center;
        border: 2px solid var(--ink);
        border-radius: 50%;
        font-family: "Chakra Petch", system-ui, sans-serif;
        font-weight: 700;
    }

    .steps h3 { font-size: 1.15rem; margin: 0 0 0.3rem; }
    .steps p { margin: 0; max-width: 62ch; }
    .steps p + p { margin-top: 0.5rem; }

    kbd, .path {
        font-family: inherit;
        font-weight: 700;
        white-space: nowrap;
    }

    kbd {
        padding: 0.05rem 0.35rem;
        border: 1px solid var(--rule);
        border-bottom-width: 2px;
        border-radius: 0.25rem;
        background: #fff;
        font-size: 0.9em;
    }

    .limits { margin: 1.25rem 0 0; padding-left: 1.2rem; }
    .limits li { margin-bottom: 0.75rem; max-width: 62ch; }
    .limits li::marker { color: var(--you); }

    footer {
        margin-top: 4.5rem;
        padding-top: 1.25rem;
        border-top: 1px solid var(--rule);
        color: var(--muted);
        font-size: 0.95rem;
    }

    @media (max-width: 52rem) {
        .page { padding-top: 2.5rem; }
        .hero { grid-template-columns: 1fr; gap: 2.5rem; }
        .field { height: 22rem; max-width: 22rem; }
    }

    @media (prefers-reduced-motion: reduce) {
        .note { animation: none; }
    }
</style>
</head>
<body>
<main class="page">
    <div class="hero">
        <div>
            <h1>MapTogether</h1>
            <p class="lede">Edit a Quaver map with friends, live. The notes, timing points and SVs you place show up in their editor, and theirs in yours.</p>
            <p class="alpha">Keep a backup of any map you care about and save often.</p>
            <div class="downloads">
                <?php if ($windows): ?>
                <a class="download" href="releases/versions.php?os=windows">Download for Windows<small>Companion <?= htmlspecialchars($windows) ?></small></a>
                <?php endif; ?>
                <?php if ($linux): ?>
                <a class="download" href="releases/versions.php?os=linux">Download for Linux<small>Companion <?= htmlspecialchars($linux) ?></small></a>
                <?php endif; ?>
            </div>
        </div>

        <div class="field" role="img" aria-label="A Quaver editor playfield where two people, Adri and A6sT, are placing notes at the same time. Each has a cursor bookmark in their own colour.">
            <div class="lanes"><span></span><span></span><span></span><span></span></div>
            <div class="line beat" style="top: 8%"></div>
            <div class="line" style="top: 26%"></div>
            <div class="line beat" style="top: 44%"></div>
            <div class="line" style="top: 62%"></div>
            <div class="line beat" style="top: 80%"></div>
            <div class="receptor"></div>

            <div class="cursor peer" style="top: 22%">A6sT</div>
            <div class="cursor you" style="top: 67%">Adri</div>

            <div class="note peer" style="top: 6%;  left: calc(4.25rem + 0.25rem);                             animation-delay: 0.3s"></div>
            <div class="note peer long" style="top: 15%; bottom: 72%; left: calc(4.25rem + 0.25rem + (100% - 5.5rem) * 0.5); animation-delay: 0.6s"></div>
            <div class="note peer" style="top: 24%; left: calc(4.25rem + 0.25rem + (100% - 5.5rem) * 0.75); animation-delay: 0.9s"></div>
            <div class="note peer" style="top: 33%; left: calc(4.25rem + 0.25rem + (100% - 5.5rem) * 0.25); animation-delay: 1.2s"></div>
            <div class="note you" style="top: 42%; left: calc(4.25rem + 0.25rem);                             animation-delay: 1.5s"></div>
            <div class="note you" style="top: 51%; left: calc(4.25rem + 0.25rem + (100% - 5.5rem) * 0.75); animation-delay: 1.8s"></div>
            <div class="note you long" style="top: 60%; bottom: 27%; left: calc(4.25rem + 0.25rem + (100% - 5.5rem) * 0.25); animation-delay: 2.1s"></div>
            <div class="note you" style="top: 78%; left: calc(4.25rem + 0.25rem + (100% - 5.5rem) * 0.5); animation-delay: 2.4s"></div>
        </div>
    </div>

    <section aria-labelledby="setup">
        <h2 id="setup">Set it up</h2>
        <ol class="steps">
            <li>
                <h3>Get the plugin</h3>
                <?php if ($workshopUrl): ?>
                <p>Subscribe to <a href="<?= htmlspecialchars($workshopUrl) ?>">MapTogether on the Steam Workshop</a>. Steam keeps it up to date for you.</p>
                <?php else: ?>
                <p>The Steam Workshop page is on its way. Until then, ask Adri for the plugin folder and put it in <span class="path">Quaver/Plugins</span>.</p>
                <?php endif; ?>
            </li>
            <li>
                <h3>Run the companion</h3>
                <p>The plugin talks to the other editors through a small companion app. Download it above, run it, and keep it open while you map. You can put it anywhere.</p>
                <p>It opens a window in your browser showing whether the plugin and the server are connected, and the open lobbies. It finds your Quaver Songs folder on its own and keeps itself and the plugin up to date. Windows may say it doesn't recognise the app: choose <span class="path">More info</span>, then <span class="path">Run anyway</span>.</p>
            </li>
            <li>
                <h3>Open the plugin in the editor</h3>
                <p>Open a map in Quaver's editor, then turn the plugin on from <span class="path">Plugins › Steam Workshop › MapTogether</span>. The window shows whether the companion is connected.</p>
            </li>
            <li>
                <h3>Host or join a session</h3>
                <p>To host, choose <span class="path">Host this map</span> and save with <kbd>Ctrl</kbd> + <kbd>S</kbd> when the plugin asks, so it can identify the map. To join, pick a session from the list in the plugin or in the companion window, then save when the plugin asks. The host accepts you, and if your copy of the map differs you can take theirs.</p>
            </li>
        </ol>
    </section>

    <section aria-labelledby="limits">
        <h2 id="limits">Known limits</h2>
        <ul class="limits">
            <li>Edits from other people don't mark your map as unsaved. Make a change of your own before saving, or Quaver won't write the file.</li>
            <li>Creating, deleting and reordering layers isn't shared yet. The plugin warns you when one of your edits wasn't sent.</li>
            <li>Keep the plugin window open while you map. Edits made while it's closed are merged when you reopen it, and the host's version wins where you both changed the same second of the song.</li>
            <li>Everyone needs the same companion version. The plugin tells you when yours is out of date.</li>
            <li>macOS isn't supported. The companion runs on Windows and Linux.</li>
        </ul>
    </section>

    <footer>
        <p>MapTogether is made by Adri for the Quaver mapping community<?= $version ? ', companion ' . htmlspecialchars($version) : '' ?>.</p>
        <p>It's free software under the GNU AGPL v3 or later. <a href="https://github.com/Adrriii/MapTogether">Source code on GitHub</a>.</p>
    </footer>
</main>
</body>
</html>
