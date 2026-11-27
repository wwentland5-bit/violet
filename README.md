# Violet v4

## Quick start (easiest)
- **First time: double-click `setup.bat`.** It does every manual step for you:
  1. Installs **Node.js** if it's missing (using winget)
  2. Installs **Claude Code** if it's missing
  3. Checks Claude Code is **logged in**. If not, it opens a login window and waits for you.
  4. Runs **npm install** (Electron + the code editor)
  5. *(Optional, ~300 MB)* Downloads **voice features**: whisper.cpp + the base and tiny speech models, Piper, and the natural voice "Amy". It also sets Violet to use them.
  6. Makes a **desktop shortcut** (opens Violet with no black console window)
  7. *(Optional)* Builds the **.exe** installer and offers to run it
  8. **Starts Violet**

  It asks its questions up front, so you can walk away while it works. It's **safe to run again** anytime, because it skips anything already done. Everything it does is saved to `setup-log.txt`.
- **Run it:** use the desktop shortcut, or double-click **`start.bat`**.
- **Make the .exe:** double-click **`build.bat`**. When it finishes, it opens the `dist` folder, which has:
  - `Violet-Setup-4.0.0.exe`: the installer, which adds Start menu and desktop shortcuts
  - `Violet-Portable-4.0.0.exe`: a single file that runs without installing
- **Start with Windows:** after installing, turn it on in Settings → General → Behavior.

Both scripts need **Node.js** (https://nodejs.org) and **Claude Code** (logged in with your Pro account).

## What's new in v4

- **Classic UI** (**Ctrl+Shift+U**): switch back to the original see-through floating panel anytime. Press it again to return to the modern UI.
- **Command palette** (**Ctrl+K**): one search box for everything: actions, chats, themes, talking styles and reminders. Type `?` to see every keyboard shortcut.
- **Slash commands:** type `/` in the chat box for quick commands like `/theme nebula`, `/remind 20m stretch`, `/timer 10 pizza`, `/remember …` and `/help`
- **Reminders:** say or type *"remind me at 5pm to call mom"*. You get a Windows notification, a chime, and Violet says it out loud.
- **Quick Ask from any app** (**Alt+Shift+A**): select text anywhere, such as a webpage, Discord or an error message, press the hotkey, and Violet opens with that text attached
- **Daily briefing** (☀ button on the dashboard, or `/briefing`): the date, weather, top headlines and your reminders, with widgets
- **Export chats** to Markdown (`/export`, or from the palette)

## What's new in v3

- **Memory Tree:** your memories as an animated mind map. You're in the center, with branches for *About you, Preferences, Projects, Tech, Hobbies, People, Places* and *Other*, and every memory as a glowing leaf. You can switch to a list anytime.
- **Voice Dashboard** (**Ctrl+D**, or the grid button): a talk-only mode with a big orb that reacts to your voice, live captions, and **widgets Violet adds and removes itself**: websites, videos, articles, notes, images, checklists, timers and links
- **Hands-free conversation:** after Violet answers, it starts listening again on its own
- **New theme:** Arc Reactor, a cyan HUD grid with a scanning line

## What's new in v2

- **Full window mode** (button in the title bar, or **F11**): a big, resizable window with a sidebar. Maximize it or snap it like any app. Press F11 again to go back to the corner panel.
- **Saved chats:** every chat is saved automatically. The sidebar lets you search, pin, rename and delete them. Each chat keeps its own memory of the conversation, so switching back and forth works.
- **Memory tab:** see everything Violet remembers about you. Add, edit, or delete memories, or turn auto-save off.
- **Projects + Violet Code:** open a project folder and Violet can read your code and **suggest file changes**. Each change appears as a card with a diff (changed lines in red/green). **Nothing is saved until you click Apply**, and every change can be undone.
- **Violet Code editor** (**Ctrl+E**): the same editor that powers VS Code, with a file tree, tabs, side-by-side review of Violet's changes, and **Ask Violet** for the code you've selected.
- **New look:** glass panels, orbit rings around the orb, a "racing light" border while Violet thinks, and two new themes (Nebula and Synthwave Sunset)


Your personal Jarvis-style assistant. It's a floating panel that pops up with a hotkey and runs on Claude Code using your Pro plan.

---

## Classic UI (Ctrl+Shift+U)
- **What it is:** the original Phase 1 look, a rounded, **see-through** panel floating in the corner, with no sidebar and minimal buttons
- **Switch:** **Ctrl+Shift+U** toggles it. You can also use the palette, `/classic`, the tray menu, or Settings → General.
- **How it switches:** Violet rebuilds its window. Your chats, memories and settings are all kept.
- **Size:** Classic is a fixed-size panel, because see-through windows can't resize well on Windows. Pressing **F11** in Classic jumps straight to the modern full window.
- **Everything else still works:** palette, slash commands, voice and all modes

## Command palette (Ctrl+K)
- Start typing and it matches as you go: *"dash"* → Voice dashboard, *"neb"* → Theme: Nebula, *"rtx"* → your RTX chat
- **↑ ↓** to move, **Enter** to run, **Esc** to close
- **Groups:** Actions · Themes · Talking style · Reminders (Enter deletes one) · Chats (searches inside messages too)
- **`?` = cheat sheet** of every shortcut, including your custom hotkeys
- **No match?** Press Enter and it asks Violet what you typed

## Slash commands
Type `/` in the chat box to see the list. **Tab** completes, and **↑ ↓** picks.

| Command | Does |
|---|---|
| `/new` | New chat |
| `/theme nebula` | Switch theme |
| `/style coder` | Switch talking style |
| `/remember I use VS Code` | Save a memory |
| `/remind 20m stretch` · `/remind 5:30pm call mom` | Set a reminder |
| `/timer 10 pizza` | Timer widget on the dashboard |
| `/browse find cheap RTX 4070s` | Web task in Violet's browser |
| `/dash` · `/briefing` · `/memory` | Open the dashboard, briefing or memory tree |
| `/classic` · `/full` · `/panel` · `/deep` | Switch UI or toggle Deepthink |
| `/export` | Save this chat as a Markdown file |
| `/help` | All commands + shortcuts |

## Reminders
- **Natural language:** *"Remind me in 20 minutes to check the oven"* or *"remind me tomorrow at 9 to call the dentist"*. Violet knows the current date and time and confirms it in plain words.
- **Fast way:** `/remind 20m stretch`, `/remind 5pm call mom`, `/remind 1h30m laundry`
- **When it's due:** a Windows notification (even when Violet is hidden), two chimes, a pop-up, and Violet reads it out (unless *Read replies aloud* is set to Never)
- **See and delete upcoming reminders:** Ctrl+K → Reminders, or the chips on the dashboard
- **Missed reminders:** if your PC was off, Violet tells you when it starts, marked "missed"
- **Where they're stored:** `%APPDATA%\Violet\reminders.json`

## Quick Ask (Alt+Shift+A)
1. Select text in any app: an error in a terminal, a paragraph on a site, a message.
2. Press **Alt+Shift+A**. Violet copies it for you, opens, and shows a "Selected text" chip.
3. Type or say your question, like *"what does this error mean?"*

**How it works:** Violet waits until you let go of the keys, presses Ctrl+C for you, reads the text, then **puts your old clipboard back** (if it was text). The first use takes a second or two while the keyboard helper starts. You can change the hotkey in Settings → General.

**Limits:** it only works with text. If nothing gets copied (some apps block copying), Violet tells you to select something first.

---

## Memory Tree
- **Open it:** Sidebar → **Memory**. It opens in **Tree** view; the **Tree / List** switch is at the top right.
- **Get around:** drag to move, scroll to zoom, **⤢** fits everything on screen
- **Read and edit:** hover a leaf to read the whole memory, or **click** it to edit the text, move it to another branch, or delete it
- **Search:** typing in the search box lights up matching leaves and fades the rest
- **How memories get a branch:** when you add a memory, pick a branch or leave it on **Auto branch**. Memories Violet saves on its own come with a branch. Older memories are sorted by keyword.
- **Dot styles:** a white ring around a leaf means *you* added it. No ring means Violet saved it.

## Voice Dashboard
- **Open it:** **Ctrl+D**, the grid button in the title bar, or Sidebar → **Dashboard**. It works best in full window mode (**F11**).
- **Talk:** **tap the orb** (or press **Space**) and talk. The orb's bars move with your voice. Violet answers **out loud**, with captions underneath.
- **Hands-free** (on by default): after Violet finishes talking, it listens again. Tap the orb while it's talking to cut it off, or press **Esc** to stop the loop.
- **Widgets:** Violet decides when a widget helps and adds it. Try:
  - *"Show me a lo-fi music video"* → **video** (YouTube, Vimeo, or .mp4)
  - *"Pull up the Steam store page for Rust"* → **website** (the live page)
  - *"Find a good article about the RTX 5070"* → **article** card with image, summary and excerpt
  - *"Make me a grocery list for tacos"* → **checklist** you can tick off
  - *"Set a 10 minute pizza timer"* → **timer** that chimes and speaks when it's done
  - *"Write down the steps"* → **note**. There are also **image** and **link** widgets.
  - *"Remove the video"* / *"Clear the dashboard"* → Violet removes widgets
- **Your controls:** each widget has **↗** (open in Violet's browser), **⤢** (small, medium or large) and **×** (remove). Widgets stay put between restarts.
- **Real links only:** Violet is told to look up real links with web search instead of making them up

**How embedding works (and its limits):**
- **Why some sites show up at all:** many sites refuse to show inside other apps. For widgets in Violet's own window only, Violet removes that block. Each widget runs **sandboxed**, so it can't touch Violet or take over the window. Your normal browser and Violet's browser are unaffected.
- **Some sites still stay blank,** for example ones that need a login or detect being embedded. Use **↗** to open those in Violet's browser.
- **YouTube** is embedded through its privacy-friendly no-cookie player

---

## Full window vs panel
- **Panel:** the compact corner window, like before. It's always on top (optional) and opens with your hotkey. The chat list slides in from **☰** (or **Ctrl+H**).
- **Full:** a normal app window with the sidebar always showing. You can minimize, maximize, or double-click the title bar. **Ctrl+H** hides the sidebar.
- Violet remembers each mode's size and position separately.
- **About the window change:** the window is no longer see-through. A solid window is what makes resizing, maximizing and full screen work properly, and Windows 11 still rounds the corners. Themes look the same.

## Saved chats
- **Where they're stored:** in `%APPDATA%\Violet\chats\`, one file per chat, saved as you go, so even a crash keeps the chat
- **Titles:** each chat is named after your first message. Hover a chat in the sidebar to **pin**, **rename** or **delete** it. Delete asks you to click twice.
- **Search:** looks through chat titles *and* message text

## Memory
- **Open it:** Sidebar → **Memory** (or **Ctrl+Shift+M**)
- **What it is:** a list of short facts, like "Prefers Python for bots". Violet includes them with every message so its answers are personal.
- **Auto-save on** (the default): when you tell Violet something lasting, it saves it and shows a "🧠 Remembered…" toast. Saying "forget that I…" removes it.
- **What it's told not to save:** passwords, money details or health info
- **Your control:** add, edit (click Edit, then Enter to save), delete, search, or **Clear all** (click twice)
- **Where it's stored:** `%APPDATA%\Violet\memory.json`, on your PC only

## Projects (code files, with your permission)
1. Sidebar → **Open a project folder…** (or use a recent one). A green **Project** chip appears above the message box.
2. Ask for something, like *"make a Discord bot that replies to !ping"* or *"add a dark mode toggle to index.html"*.
3. Violet reads your files (read-only) and replies with **change cards**:
   - **New file / Edit / Delete** badge, plus how many lines were added and removed
   - A diff: green = added, red = removed
   - **Apply**, **Reject**, or **Review in editor** (side-by-side view)
4. After you apply, an **Undo** button appears. Violet backs up the old file first. Backups are in `%APPDATA%\Violet\backups\`.
5. With several changes, **Apply all** does them in one click.

**Safety:**
- **Claude can't write files.** Claude Code's file-writing and command tools stay blocked. Only Violet writes, and only after you click.
- **Folder limits:** every path is checked to be inside your project folder. `../` tricks and links pointing outside are blocked. The `.git` folder is never touched. Violet won't let you pick a whole drive or your entire user folder as a project.
- **Big files:** files over 2 MB aren't opened or edited

**Common mistake:** applying an old card after you've edited that file yourself. Violet backs up your current version first, so **Undo** brings your edits back. Still, it's best to apply changes before editing the same file by hand.

## Violet Code (the editor)
- **Open it:** **Ctrl+E**, the `</>` button, or **Editor** on the project chip
- **Basics:** file tree on the left (folders load when you click them), tabs, **Ctrl+S** to save, **Ctrl+W** to close a tab, middle-click a tab to close it
- **Review in editor:** opens Violet's suggested change side by side (current file on the left, the new version on the right) with **Apply** and **Reject** buttons
- **Ask Violet** (**Ctrl+Shift+A**): sends the selected code (or the whole file) to the chat as a chip, so you can ask "why is this slow?"
- **Applied changes:** if Violet applies a change to a file you have open, the editor reloads it. If you have unsaved edits, you get a "changed on disk" banner instead, so nothing gets overwritten.
- **Install note:** the editor comes from the `monaco-editor` package, which `npm install` downloads. If it says "not installed", run `npm install` again.

---

## What's new in Phase 4

- **Browse mode** (globe pill): Violet does web tasks **in its own browser** by itself. You can watch, and you can **take control** anytime.
- **Talk to Violet:** use the mic button or press **Alt+Shift+Space**. Speech recognition is fully local, using whisper.cpp.
- **Violet talks back:** with built-in Windows voices, or **custom voices** through Piper (drop in any voice file)
- **"Hey Violet" wake word** (experimental, off by default)

## What's new in Phase 3

- **Violet's own browser** (globe button, **Ctrl+B**, or the tray menu): tabs, an address bar that also searches, back/forward, and logins that are saved between sessions, all in Violet's theme
- **Ask Violet button:** sends the page you're on to the chat. A page chip appears and your next question is about that page. You can also right-click selected text and choose **Ask Violet about "…"**.
- **Chat links open in Violet's browser.** You can turn this off in Settings → General.
- **Desktop widgets:** Clock, System (CPU + RAM), Weather, Notes, and Server status. Drag them anywhere and they remember where you put them.

## What's in Phase 2

- **Look** (eye button): attaches a screenshot of your main monitor to your next message. Example: "what's this error?"
- **Control** (cursor button): Violet uses your mouse and keyboard to do a task. Example: "open Spotify and play my liked songs"
- **Permission cards:** nothing touches your screen until you click **Allow**
- **Glowing border + status pill** while Violet is in control
- **Esc** (or your hotkey) stops it instantly
- **Step log in chat:** shows what Violet saw and did at each step
- **Safety limits:** a max-steps limit, a fixed list of allowed actions, and Violet asks before buying, sending, deleting, or entering passwords

## What's in Phase 1

- Floating panel in the bottom-right corner that lives in the system tray
- Hotkey to show or hide it: **Alt+Shift+V** by default, and you can change it in Settings
- Streaming chat through `claude -p`, with follow-up questions keeping their context
- **Deepthink mode:** switches to a stronger model and tells it to reason more carefully
- **Custom prompts:** presets you can switch from the chip at the top, and add or edit in Settings
- **Themes:** 4 built-in themes, 2 of them animated. To add your own, drop a `.json` into the themes folder or drag it onto the window.
- Web search can be turned on or off
- Low-power mode pauses animations while Violet is hidden

---

## 1. Requirements

| Thing | Why | Check it |
|---|---|---|
| **Node.js 20+** | runs Electron | `node --version` |
| **Claude Code** | Violet's brain | `claude --version` |
| Claude Code logged in with your **Pro** account | so it doesn't bill an API key | run `claude` once and log in |

The only libraries are `electron` and `electron-builder`. Everything else is built in, which helps keep RAM use low.

## 2. Install and run

Unzip the `violet` folder somewhere like `C:\Users\you\Projects\violet`, then open PowerShell **in that folder**:

```powershell
npm install
npm start
```

Violet pops up in the bottom-right corner, and a violet orb appears in your system tray.

- **Alt+Shift+V**: show or hide
- **Esc**: hide
- **Ctrl+N**: new chat
- **Ctrl+,**: settings
- **Enter** sends. **Shift+Enter** adds a new line.
- Drag the title bar to move Violet. It remembers where you put it. To reset the position, use the tray menu: **Reset window position**.

## 3. Build an .exe

```powershell
npm run dist
```

You'll find both an installer and a portable `.exe` in the `dist\` folder.

---

## File structure

```
violet/
├─ package.json      # app info, scripts, exe build settings
├─ main.js           # the "backend": windows, tray, hotkey, settings, themes, wiring
├─ claude.js         # Claude Code bridge: runs `claude -p`, streams replies
├─ agent.js          # Control mode loop: screenshot -> Claude -> actions -> repeat
├─ input.js          # mouse/keyboard driver (hidden PowerShell + Windows SendInput)
├─ screen.js         # screenshots of your main monitor
├─ browser.js        # Violet's browser: window, tabs, navigation, "Ask Violet", agent lock
├─ browser-agent.js  # Browse mode: Violet drives its own browser (page map + screenshot loop)
├─ voice.js          # Piper (custom voices) + whisper.cpp (speech recognition)
├─ chats.js          # saved chats (one JSON file per chat)
├─ memory.js         # Violet's memories + <remember>/<forget> handling
├─ projects.js       # project folder, change cards, diffs, apply/undo/backups
├─ ide.js            # Violet Code editor window (main side)
├─ ide-preload.js    # what the editor window may call
├─ dashboard.js      # voice dashboard widgets: storage, validation, article previews
├─ reminders.js      # reminders: parsing "20m"/"5pm", notifications, <violet_reminder> tags
├─ setup.bat         # double-click: does ALL the setup (Node, Claude Code, voice, shortcut, exe)
├─ tools/setup.ps1   # the script setup.bat runs (edit download links here if one moves)
├─ build.bat         # double-click: build the installer + portable exe
├─ start.bat         # double-click: run Violet without building
├─ browser-preload.js# what the browser toolbar is allowed to call
├─ widgets.js        # desktop widgets: windows + CPU/weather/server data
├─ widget-preload.js # what widget windows are allowed to call
├─ preload.js        # safe bridge: the only things the UI is allowed to call
├─ src/
│  ├─ index.html     # layout: title bar, chat, settings, composer
│  ├─ styles.css     # all styling; colors are CSS variables that themes override
│  ├─ renderer.js    # UI logic: chat, streaming, themes, prompts, settings, permissions
│  ├─ md.js          # tiny, safe Markdown renderer for Claude's replies
│  ├─ overlay.*      # the glowing "in control" border + status pill
│  ├─ browser.*      # browser toolbar (tabs, address bar, Ask Violet)
│  ├─ widget.*       # all widget designs (one page, picks the type)
│  ├─ theme.js       # shared theme helper for the browser + widgets
│  ├─ voice.js       # mic, voice detection, wake word, reading replies aloud
│  ├─ v2.js          # full window, chat sidebar, memory tab, change cards
│  ├─ v3.js          # memory tree + voice dashboard and its widgets
│  ├─ v4.js          # command palette, slash commands, Classic UI, reminders, quick ask
│  ├─ ide.*          # Violet Code editor (Monaco)
│  └─ browse-lock.*  # see-through layer that locks the page while Violet drives
├─ themes/           # built-in themes (copied to your themes folder on first run)
└─ assets/           # app + tray icons
```

**Where your stuff lives:** `%APPDATA%\Violet\`
- `settings.json`: all your settings and custom prompts
- `themes\`: put theme files here
- `workspace\`: the folder Claude Code runs in, kept separate so it never touches your projects
- `workspace\screens\`: recent screenshots. They're cleared at the start of each control task.
- `notes.txt`: whatever you type in the Notes widget (autosaved)

**How a message flows:** you type → `renderer.js` → `preload.js` → `main.js` runs `claude -p` and sends your message through **stdin** → Claude streams JSON back → `main.js` forwards each chunk → the UI renders it live.

Your message goes through stdin and never onto the command line. That avoids Windows quoting bugs and stops a weird message from being run as a command.

---

## Browse mode: Violet drives its own browser

1. Click the **Browse** pill (cyan globe) and type a task, like *"find the cheapest RTX 4070 on Newegg"* or *"check if the new Minecraft update is out and summarize the patch notes"*.
2. Violet's browser opens, and Violet starts working **by itself**. The page gets a glowing border and is **locked**, so only Violet drives it.
3. The toolbar shows what it's doing, along with **Take control** and **Stop** buttons.
4. **Take control** pauses Violet and unlocks the page so you can drive, for example to log in or solve a CAPTCHA. Click **Let Violet continue** and it re-checks the page and picks up where it left off.
5. Progress shows up in the chat as a step log, followed by the answer.

**How it "sees" pages:** each step, Violet numbers every visible button, link and field (`[12] button "Add to cart"`) and also looks at a screenshot of **just the page**. It then picks actions by number, which is much more reliable than guessing pixel positions. Clicks and typing are real mouse and keyboard events *inside* the page.

**Why this is better than Control mode for web stuff:** it never touches your mouse, keyboard or screen, so you can keep using your PC while it works. It also doesn't need a permission card.

**Safety:**
- **It asks first** before buying, paying, sending, deleting, or changing account settings
- **It never types passwords.** It asks you to take control and type them yourself.
- **Logins, CAPTCHAs, and "are you human" checks:** it stops and tells you to take control
- **Page text is treated as content, not commands**

**Usage tip:** screenshots make Browse mode smarter but use more of your limit. You can turn them off in **Settings → General → Browser**, and it will work from the numbered list alone.

**Limits:** it can't click inside cross-site iframes (like some embedded payment boxes) by number. It falls back to screenshot coordinates there, or asks you.

---

## Voice

### Talking to Violet
Click the **mic** (or press **Alt+Shift+Space** from anywhere) and talk. Violet stops listening when you pause, transcribes **on your PC** with whisper.cpp, and sends your message. When you ask by voice, it reads the answer back by default.

- **Esc** stops listening or stops it talking. Clicking the status line also stops it talking.
- Settings → Voice → **Send automatically** off = your words go into the text box so you can edit them first

### One-time setup for speech recognition (about 5 minutes)
1. Download **`whisper-bin-x64.zip`** from the whisper.cpp releases page: https://github.com/ggml-org/whisper.cpp/releases
2. In Violet, go to **Settings → Voice → Open speech folder**. That opens `%APPDATA%\Violet\whisper\`.
3. Unzip the zip into that folder. It's fine if it ends up inside a `Release` subfolder.
4. Download a model from https://huggingface.co/ggerganov/whisper.cpp/tree/main and put it in the same folder:
   - **`ggml-base.en.bin`** (~140 MB): recommended. A good balance of speed and accuracy.
   - **`ggml-tiny.en.bin`** (~75 MB): add this too if you want the wake word. It's the fastest.
   - **`ggml-small.en.bin`** (~460 MB): more accurate, but slower
5. Reopen Settings → Voice. It should say **"Speech recognition ready"**. Pick your model.

If it fails with a missing DLL error, install the Microsoft Visual C++ Redistributable (x64).

### Voices
- **Windows voices** work right away. Pick one in Settings → Voice. To get more, go to Windows Settings → Time & language → Speech → **Add voices**.
- **Custom voices (Piper):** natural-sounding, offline, and you can add as many as you like
  1. Download **`piper_windows_amd64.zip`** from https://github.com/rhasspy/piper/releases
  2. **Settings → Voice → Voice engine: Piper → Open voices folder**. Go up one level and unzip Piper into the **`piper`** folder.
  3. Get voices from https://huggingface.co/rhasspy/piper-voices. Each voice needs **two files**, `name.onnx` **and** `name.onnx.json`. Put both in the **`voices`** folder.
  4. Reopen Settings → Voice, pick the voice, and click **Test voice**.
  - Any Piper-compatible `.onnx` voice works, including ones you train yourself. That's the "custom voices" part.
- **Speed** works for both engines. **Pitch** only works for Windows voices.

### "Hey Violet" (experimental)
Turn it on in **Settings → Voice → Wake word**. Violet listens for short bursts of speech and transcribes them locally with your **smallest** model, then checks whether they start with "Hey Violet" (or "OK Violet"). If you say the whole thing in one go, like *"Hey Violet, what's the weather?"*, it answers right away. If you just say "Hey Violet", it chimes and listens for your command.

**Honest notes:**
- **CPU use:** it transcribes whenever someone talks near the mic (including your TV), so expect some CPU use. Use `ggml-tiny.en.bin` to keep it light.
- **Privacy:** all audio stays on your PC. Nothing is uploaded or saved, apart from one temporary file that gets overwritten.
- **Accuracy:** it can miss you or trigger by accident sometimes. That's why it's off by default.

**Microphone not working?** Go to Windows Settings → Privacy & security → Microphone, and turn on **"Let desktop apps access your microphone"**.

---

## The browser

**Shortcuts:**
- **Ctrl+T**: new tab
- **Ctrl+W**: close tab
- **Ctrl+L**: address bar
- **Ctrl+Tab**: next tab
- **F5**: reload
- **Alt+←/→**: back/forward
- **F12**: dev tools
- **Middle-click** a tab to close it

**Ask Violet:** click it on any page, then ask "summarize this", "is this a good deal?", or "explain this code". Violet reads up to about 15,000 characters of the page text. The page only goes with your **next** message, and you can remove it with the × on the chip.

**Privacy and safety:**
- **Separate storage:** the browser keeps its own cookies and logins, apart from Violet itself
- **Sandboxed pages:** websites get no access to Violet or your files
- **No camera, mic, or location:** sites are denied these by default
- **Page text is treated as content, not commands,** so a sneaky page can't tell Violet what to do

**Honest limits:** there's no ad blocker or extensions yet, and some sites, especially Google sign-in, may complain about a "less common browser". If a site won't work, use your normal browser for that one.

## Widgets

Turn them on in **Settings → Widgets**.

| Widget | What it shows | Setup |
|---|---|---|
| Clock | Time + date (12 or 24 hour) | none |
| System | CPU %, memory, uptime | none |
| Weather | Current conditions, high/low, wind, humidity | type your city. It uses the free Open-Meteo service, so you don't need an account or key. |
| Notes | A sticky note that autosaves | none |
| Servers | Green/red dot + response time for each address | one per line, like `Plex \| http://192.168.1.20:32400` |

- **Drag** a widget to move it. Hover and click **×** to hide it.
- **"Keep widgets on top" off** (the default) means they sit on your desktop behind your windows. Turn it on to keep them always visible.
- **Lock positions** stops you from dragging them by accident.

**Honest limits:**
- **No GPU stats or temperatures yet.** Windows doesn't give those out easily without extra tools. It's a good candidate for a later add-on.
- **Server check rules:** a server counts as up if it answers at all (even a login page). HTTPS servers with self-signed certificates will show as down, so use their `http://` address.
- **Win+D hides widgets.** "Show desktop" hides them along with everything else.

---

## How Control mode works

1. You turn on **Control**, type a task, and click **Allow**.
2. Violet hides its panel and shows the glowing border.
3. It takes a screenshot, shrunk to 1280px wide so it's faster and uses less of your limit, and asks Claude what to do.
4. Claude replies with a short JSON list of actions, like `click`, `type`, `key`, `scroll` or `open`.
5. Violet checks each action against its fixed list, runs it, and takes a new screenshot.
6. This repeats until Claude says it's **done**, needs to **ask** you something, you press **Esc**, or the step limit is reached.

**Why it's built this way:** Claude never gets direct access to your PC. It can only *suggest* actions from a short list, and Violet is the one that runs them. Claude Code's own command and file-editing tools stay blocked the whole time.

**When Violet asks you something** (like "should I send this?"), reply with Control still on and it picks up where it left off.

**Settings → General → Control mode:**
- **Ask before every control task:** on by default. Turn it off to approve once per chat.
- **Max steps:** default 25
- **Action speed:** Fast, Normal, or Careful. Use Careful for slow apps.

**Honest limits:**
- **It's slow-ish.** Each step takes a few seconds while Claude looks and decides. It's great for errands like "open X, find Y, click Z", but it can't play games.
- **Main monitor only** for now
- **It may misclick small targets.** It looks again after every step and corrects itself, but high-DPI screens with tiny buttons are the hardest case.
- **Screenshots use a lot of your usage limit.** A 10-step task uses noticeably more of your limit than a normal chat.
- **Admin windows can't be controlled.** If an app is running as admin (or a UAC prompt is up), Windows blocks Violet's clicks into it unless Violet is also run as admin.

---

## Making your own theme

Create a file like `my-theme.json` and put it in `%APPDATA%\Violet\themes\`. To open that folder, go to **Settings → Look → Open themes folder**. The theme appears instantly. If you edit the file while it's active, Violet reloads it live, which makes tweaking easy.

```json
{
  "name": "Ocean",
  "author": "Wyatt",
  "colors": {
    "bg": "rgba(6,20,32,0.92)",
    "text": "#e6f6ff",
    "muted": "#8fb3c9",
    "accent": "#38bdf8",
    "accent2": "#a78bfa",
    "border": "rgba(255,255,255,0.1)",
    "surface": "rgba(255,255,255,0.05)",
    "surface2": "rgba(255,255,255,0.1)",
    "userBubble": "linear-gradient(135deg, #0284c7, #7c3aed)",
    "userText": "#ffffff",
    "assistantBubble": "rgba(255,255,255,0.05)",
    "codeBg": "rgba(0,0,0,0.35)",
    "glow": "0 0 24px rgba(56,189,248,0.35)"
  },
  "font": "Segoe UI Variable Text, Segoe UI, sans-serif",
  "radius": 18,
  "background": {
    "type": "aurora",
    "colors": ["#0369a1", "#7c3aed", "#0d9488"],
    "speed": 18
  },
  "css": ".brand-name { letter-spacing: 2px; }"
}
```

Only `name` and `colors` are required. Leave out any color and Violet uses its default.

**Background types:**

| `type` | Extra keys | Animated? |
|---|---|---|
| `solid` | none (uses `colors.bg`) | no |
| `gradient` | `colors` (2+), `angle` | no |
| `animated-gradient` | `colors` (2+), `angle`, `speed` (seconds) | yes |
| `aurora` | `colors` (up to 3 blobs), `speed`, optional `base` | yes |
| `image` | `src`: file name next to the theme, e.g. `"bg.png"` | no |
| `video` | `src`: e.g. `"loop.webm"` (`.mp4` and `.webm` work) | yes |

For image and video themes, put the media file next to the `.json`. When you import with the button or by drag-and-drop, Violet copies the media file too.

**Tip:** use semi-transparent colors like `rgba(..., 0.9)` and your desktop will faintly show through.

**Only import themes you trust.** The `css` field can restyle anything in the window. It can't run code, though, because scripts are blocked.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "I couldn't start Claude Code" | Run `where claude` in PowerShell, then paste that full path into **Settings → General → Claude command**. |
| "Claude Code isn't logged in" | Run `claude` in a terminal, sign in, then try again. |
| Hotkey doesn't work | Another app has it (PowerToys likes Alt+Space). Pick a new combo in **Settings → General**. |
| `npm install` fails on Electron | Delete `node_modules` and run `npm install` again. This is usually a network hiccup during the download. |
| Replies show up all at once instead of streaming | Your Claude Code is older. Violet detects this and falls back automatically. Running `npm install -g @anthropic-ai/claude-code` (or `claude update`) brings back streaming. |
| Control mode: "input helper took too long to start" | Your antivirus may be blocking hidden PowerShell. Allow Violet in your antivirus, or run `powershell -NoProfile -Command "Add-Type -TypeDefinition 'public class T{}'"` to check that PowerShell works. |
| Clicks land in the wrong spot | Make sure the app is on your **main** monitor. If you use display scaling (125% or 150%), restart Violet after changing it. |
| Esc doesn't stop it | Press your hotkey (Alt+Shift+V) instead, or use the tray icon: **Stop control**. |
| Look / Control says it can't see the image | Update Claude Code (`claude update`). Older versions can't read images. |
| Deepthink errors out | Your plan might not include the model named in **Settings → General → Deepthink model**. Clear that box to use the default. |

## Common mistakes

- **Having `ANTHROPIC_API_KEY` set in your environment.** Violet removes it before starting Claude Code so you stay on your Pro plan. Other tools might still use it, though.
- **Running `npm start` from the wrong folder.** Run it in the folder that contains `package.json`.
- **Editing the themes in the project's `themes/` folder.** Those are only copied on first run. Edit the ones in `%APPDATA%\Violet\themes\` instead.

---

## What's next

- ~~Phase 2: screen vision + mouse/keyboard control~~ ✅
- ~~Phase 3: Violet's own browser + desktop widgets~~ ✅
- ~~Phase 4: voice, custom voices, wake word, and Browse mode~~ ✅
- ~~v2: full window, saved chats, memory tab, projects + code editor, exe build~~ ✅
- ~~v3: memory tree, voice dashboard with AI-controlled widgets, Arc Reactor theme~~ ✅
- ~~v4: Classic UI toggle, command palette, slash commands, reminders, Quick Ask, briefing, export~~ ✅
- **Ideas for later:** an ad blocker for Violet's browser, GPU temperature widget, now-playing widget, memory of facts about you, multi-monitor control
