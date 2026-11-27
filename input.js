// ============================================================
// Violet - mouse & keyboard driver (Windows)
// Starts ONE hidden PowerShell process that compiles a tiny C#
// helper calling the Windows SendInput API, then keeps it alive
// and sends it one JSON command per line. Starting it once
// (~1-2s) means every action after that is instant.
// No native npm modules = nothing to compile or break on updates.
// ============================================================
const { spawn } = require('child_process');

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

public static class VInput {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion u; }

  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vKey);

  // Wait until you let go of Ctrl/Shift/Alt/Win (so our Ctrl+C isn't mixed with your hotkey)
  public static void WaitMods(int maxMs) {
    int waited = 0;
    while (waited < maxMs) {
      bool down = (GetAsyncKeyState(0x10) & 0x8000) != 0 || (GetAsyncKeyState(0x11) & 0x8000) != 0 ||
                  (GetAsyncKeyState(0x12) & 0x8000) != 0 || (GetAsyncKeyState(0x5B) & 0x8000) != 0;
      if (!down) return;
      Thread.Sleep(20); waited += 20;
    }
  }

  static INPUT M(uint flags, uint data) { var i = new INPUT(); i.type = 0; i.u.mi.dwFlags = flags; i.u.mi.mouseData = data; return i; }
  static INPUT K(ushort vk, ushort scan, uint flags) { var i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; return i; }
  static void Send(INPUT[] a) { SendInput((uint)a.Length, a, Marshal.SizeOf(typeof(INPUT))); }

  // Arrow keys, Home/End, PgUp/PgDn, Ins/Del and Win keys need the "extended" flag.
  static uint Ext(ushort vk) { return ((vk >= 0x21 && vk <= 0x2E) || vk == 0x5B || vk == 0x5C) ? 1u : 0u; }

  public static void Move(int x, int y) { SetCursorPos(x, y); }

  public static void Click(int x, int y, string button, int count) {
    SetCursorPos(x, y); Thread.Sleep(40);
    uint down = button == "right" ? 0x0008u : (button == "middle" ? 0x0020u : 0x0002u);
    uint up = down << 1;
    for (int c = 0; c < count; c++) { Send(new[] { M(down, 0), M(up, 0) }); Thread.Sleep(70); }
  }

  public static void Drag(int x1, int y1, int x2, int y2) {
    SetCursorPos(x1, y1); Thread.Sleep(60);
    Send(new[] { M(0x0002, 0) });
    for (int s = 1; s <= 25; s++) { SetCursorPos(x1 + (x2 - x1) * s / 25, y1 + (y2 - y1) * s / 25); Thread.Sleep(15); }
    Thread.Sleep(60);
    Send(new[] { M(0x0004, 0) });
  }

  public static void Scroll(int x, int y, int notches) {
    SetCursorPos(x, y); Thread.Sleep(40);
    Send(new[] { M(0x0800, unchecked((uint)(notches * 120))) });
  }

  // Types any text (emoji, accents, etc.) using Unicode key events.
  public static void Type(string text) {
    foreach (char ch in text) {
      if (ch == '\r') continue;
      if (ch == '\n') { Combo(new ushort[] { 0x0D }); continue; }
      Send(new[] { K(0, ch, 0x0004), K(0, ch, 0x0004 | 0x0002) });
      Thread.Sleep(6);
    }
  }

  // Presses keys in order, then releases them in reverse (e.g. Ctrl, Shift, Esc).
  public static void Combo(ushort[] vks) {
    var list = new List<INPUT>();
    foreach (var vk in vks) list.Add(K(vk, 0, Ext(vk)));
    for (int i = vks.Length - 1; i >= 0; i--) list.Add(K(vks[i], 0, Ext(vks[i]) | 0x0002));
    Send(list.ToArray());
  }
}
"@

[VInput]::SetProcessDPIAware() | Out-Null
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $c = $null
  try {
    $c = $line | ConvertFrom-Json
    switch ($c.op) {
      'move'   { [VInput]::Move([int]$c.x, [int]$c.y) }
      'click'  { [VInput]::Click([int]$c.x, [int]$c.y, [string]$c.button, [int]$c.count) }
      'drag'   { [VInput]::Drag([int]$c.x, [int]$c.y, [int]$c.toX, [int]$c.toY) }
      'scroll' { [VInput]::Scroll([int]$c.x, [int]$c.y, [int]$c.amount) }
      'type'   { [VInput]::Type([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($c.b64))) }
      'keys'   { [VInput]::Combo([uint16[]]$c.vks) }
      'waitmods' { [VInput]::WaitMods([int]$c.ms) }
      'open'   { Start-Process -FilePath ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($c.b64))) }
    }
    [Console]::Out.WriteLine('OK ' + $c.id)
  } catch {
    $id = if ($c) { $c.id } else { 0 }
    [Console]::Out.WriteLine('ERR ' + $id + ' ' + ($_.Exception.Message -replace '\s+', ' '))
  }
  [Console]::Out.Flush()
}
`;

// Key names Claude can use -> Windows virtual-key codes
const VK = {
  ctrl: 0x11, control: 0x11, alt: 0x12, shift: 0x10, win: 0x5B, windows: 0x5B, meta: 0x5B, cmd: 0x5B,
  enter: 0x0D, return: 0x0D, tab: 0x09, esc: 0x1B, escape: 0x1B, space: 0x20,
  backspace: 0x08, delete: 0x2E, del: 0x2E, insert: 0x2D,
  up: 0x26, down: 0x28, left: 0x25, right: 0x27,
  home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  capslock: 0x14, printscreen: 0x2C,
  volumeup: 0xAF, volumedown: 0xAE, mute: 0xAD,
  playpause: 0xB3, nexttrack: 0xB0, prevtrack: 0xB1
};

/** "ctrl+shift+t" -> [0x11, 0x10, 0x54]. Throws on unknown keys. */
function parseKeys(combo) {
  const parts = String(combo).toLowerCase().split('+').map(s => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('No keys given');
  return parts.map(p => {
    if (VK[p] !== undefined) return VK[p];
    if (/^[a-z]$/.test(p)) return p.toUpperCase().charCodeAt(0);  // A-Z = 0x41-0x5A
    if (/^[0-9]$/.test(p)) return p.charCodeAt(0);                // 0-9 = 0x30-0x39
    const f = p.match(/^f([1-9]|1[0-2])$/);
    if (f) return 0x6F + Number(f[1]);                            // F1 = 0x70
    throw new Error(`Unknown key "${p}"`);
  });
}

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

class InputDriver {
  constructor() {
    this.proc = null;
    this.ready = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  start() {
    if (this.ready) return this.ready;
    if (process.platform !== 'win32') {
      return Promise.reject(new Error('Mouse and keyboard control only works on Windows.'));
    }
    this.ready = new Promise((resolve, reject) => {
      // -EncodedCommand = script passed as base64 UTF-16, so no quoting problems at all.
      const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
      const proc = spawn('powershell.exe', [
        '-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encoded
      ], { windowsHide: true });
      this.proc = proc;

      let buf = '';
      let stderr = '';
      const timer = setTimeout(() => reject(new Error('The input helper took too long to start.')), 20000);

      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line === 'READY') { clearTimeout(timer); resolve(); continue; }
          const m = line.match(/^(OK|ERR) (\d+)\s?(.*)$/);
          if (!m) continue;
          const p = this.pending.get(Number(m[2]));
          if (!p) continue;
          this.pending.delete(Number(m[2]));
          if (m[1] === 'OK') p.resolve();
          else p.reject(new Error(m[3] || 'Action failed'));
        }
      });
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (c) => { stderr += c; });
      proc.on('error', (err) => { clearTimeout(timer); reject(err); });
      proc.on('close', () => {
        clearTimeout(timer);
        reject(new Error(`Input helper stopped. ${stderr.slice(0, 300)}`));
        for (const p of this.pending.values()) p.reject(new Error('Input helper stopped.'));
        this.pending.clear();
        this.proc = null;
        this.ready = null; // next start() spins up a fresh one
      });
    });
    return this.ready;
  }

  async send(cmd) {
    await this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Action timed out'));
      }, 15000);
      this.pending.set(id, {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });
      this.proc.stdin.write(JSON.stringify({ ...cmd, id }) + '\n');
    });
  }

  move(x, y) { return this.send({ op: 'move', x, y }); }
  click(x, y, button = 'left', count = 1) { return this.send({ op: 'click', x, y, button, count }); }
  drag(x, y, toX, toY) { return this.send({ op: 'drag', x, y, toX, toY }); }
  scroll(x, y, amount) { return this.send({ op: 'scroll', x, y, amount }); }
  type(text) { return this.send({ op: 'type', b64: b64(text) }); }
  keys(vks) { return this.send({ op: 'keys', vks }); }
  waitMods(ms = 1500) { return this.send({ op: 'waitmods', ms }); }
  open(target) { return this.send({ op: 'open', b64: b64(target) }); }

  stop() {
    if (this.proc) { this.proc.stdin.end(); this.proc.kill(); }
  }
}

module.exports = { InputDriver, parseKeys };
