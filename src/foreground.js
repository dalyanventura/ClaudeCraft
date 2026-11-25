// Appels Win32 via koffi :
//  - détection de la fenêtre au premier plan (quel programme est actif) ;
//  - gestion de l'ordre d'empilement des fenêtres de l'overlay (au-dessus du jeu,
//    ou juste derrière l'application que vous venez d'ouvrir), sans jamais les
//    masquer ni les réafficher (ce qui provoquait de la latence).
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

// Les HWND sont manipulés comme des entiers (intptr_t) pour pouvoir les comparer.
const GetForegroundWindow = user32.func('intptr_t __stdcall GetForegroundWindow()');
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32 *pid)');
const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hWnd, int index)');
const SetWindowLongPtrW = user32.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hWnd, int index, intptr_t value)');
const SetWindowPos = user32.func('bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t after, int x, int y, int cx, int cy, uint32 flags)');
const MonitorFromWindow = user32.func('intptr_t __stdcall MonitorFromWindow(intptr_t hWnd, uint32 flags)');
const OpenProcess =kernel32.func('void * __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)');
const QueryFullProcessImageNameW = kernel32.func('bool __stdcall QueryFullProcessImageNameW(void *h, uint32 flags, _Out_ uint8_t *buf, _Inout_ uint32 *size)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void *h)');

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const HWND_TOPMOST = -1;
const HWND_NOTOPMOST = -2;
const SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOACTIVATE = 0x0010;
const SWP_FLAGS = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE;

const nameCache = new Map(); // pid -> nom de l'exécutable (ex. "wow.exe")

function processName(pid) {
  if (nameCache.has(pid)) return nameCache.get(pid);
  let name = null;
  const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (h) {
    try {
      const buf = Buffer.alloc(1024);
      const size = [buf.length / 2];
      if (QueryFullProcessImageNameW(h, 0, buf, size)) {
        const full = buf.toString('utf16le', 0, size[0] * 2);
        name = full.split('\\').pop().toLowerCase();
      }
    } finally {
      CloseHandle(h);
    }
  }
  if (nameCache.size > 200) nameCache.clear();
  nameCache.set(pid, name);
  return name;
}

/** Retourne { hwnd, pid, name } de la fenêtre au premier plan, ou null. */
function getForeground() {
  const hwnd = Number(GetForegroundWindow());
  if (!hwnd) return null;
  const pidOut = [0];
  GetWindowThreadProcessId(hwnd, pidOut);
  const pid = pidOut[0];
  if (!pid) return null;
  return { hwnd, pid, name: processName(pid) };
}

/** HWND (entier) d'une BrowserWindow Electron. */
function hwndOf(browserWindow) {
  const buf = browserWindow.getNativeWindowHandle();
  return Number(buf.length >= 8 ? buf.readBigUInt64LE(0) : buf.readUInt32LE(0));
}

/** Identifiant (HMONITOR) de l'écran qui contient la plus grande partie de la fenêtre. */
function monitorOf(hwnd) {
  const MONITOR_DEFAULTTONEAREST = 2;
  return Number(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST));
}

/** Place la fenêtre au-dessus de tout (y compris d'un jeu en plein écran fenêtré). */
function setTopmost(hwnd) {
  return SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_FLAGS);
}

/** Retire la fenêtre du premier plan et la glisse juste derrière `behindHwnd`. */
function placeBehind(hwnd, behindHwnd) {
  SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_FLAGS);
  if (behindHwnd) SetWindowPos(hwnd, behindHwnd, 0, 0, 0, 0, SWP_FLAGS);
}

/**
 * Transforme la fenêtre en "fenêtre outil" : elle n'apparaît ni dans la barre des
 * tâches ni dans Alt+Tab, on ne peut donc pas l'amener devant une autre application.
 */
function setToolWindow(hwnd) {
  const GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000;
  const style = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (style | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW);
}

module.exports = { getForeground, hwndOf, monitorOf, setTopmost, placeBehind, setToolWindow };
