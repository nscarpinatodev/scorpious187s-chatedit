import { MODULE, SETTINGS, localize } from "./const.mjs";

const SOCKET = `module.${MODULE}`;
const THROTTLE_MS = 2000; // local: minimum gap between "start" broadcasts
const IDLE_MS = 4000;     // local: stop broadcasting after this much inactivity
const EXPIRE_MS = 6000;   // remote: auto-clear a typer if no refresh/stop arrives

/**
 * Discord-style "<user> is typing" indicator shown directly above the chat box.
 *
 * Each client listens for input on its own chat composer and broadcasts a
 * throttled start/stop over the module socket. Every client keeps the set of
 * who is currently typing and renders the indicator above the chat input. Names
 * are resolved locally from the user id, so only ids travel over the wire.
 */
export class Typing {

  /** userId -> expiry timeout handle for remote users currently shown typing. */
  static _remote = new Map();

  /** Local broadcast bookkeeping. */
  static _lastEmit = 0;
  static _idleTimer = null;
  static _broadcasting = false;

  static init() {
    if (!game.settings.get(MODULE, SETTINGS.TYPING)) return;

    game.socket.on(SOCKET, Typing._onSocket);

    // (Re)inject the indicator whenever a chat log renders (sidebar or popout).
    Hooks.on("renderChatLog", (app, html) => Typing._onRenderChatLog(html));

    // Stop broadcasting the moment a message is actually sent from the input.
    Hooks.on("chatMessage", () => Typing._emit("stop"));
  }

  /* -------------------------------------------- */
  /* Local typing detection                        */
  /* -------------------------------------------- */

  /**
   * Inject the indicator and wire input listeners for one chat log.
   * @param {HTMLElement|jQuery} html The rendered chat log element.
   */
  static _onRenderChatLog(html) {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    // The only textarea inside a chat log is the message composer.
    const textarea = root.querySelector(
      "textarea[name='chat-message'], #chat-message, textarea.chat-input, textarea"
    );
    if (!textarea) return;

    // Create the indicator directly above the input area (once per chat log).
    if (!root.querySelector(".chatedit-typing-indicator")) {
      const anchor = textarea.closest("form, .chat-input, .chat-form") ?? textarea;
      const indicator = document.createElement("div");
      indicator.className = "chatedit-typing-indicator";
      indicator.hidden = true;
      indicator.innerHTML =
        '<span class="chatedit-typing-dots"><i></i><i></i><i></i></span>' +
        '<span class="chatedit-typing-text"></span>';
      anchor.before(indicator);
    }

    // Attach input listeners once per textarea element.
    if (!textarea.dataset.chateditTyping) {
      textarea.dataset.chateditTyping = "1";
      textarea.addEventListener("input", Typing._onInput);
      textarea.addEventListener("blur", () => Typing._emit("stop"));
      textarea.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) Typing._emit("stop");
      });
    }

    Typing._refresh();
  }

  /**
   * Handle local input on the chat composer.
   * @param {InputEvent} event
   */
  static _onInput(event) {
    const value = event.currentTarget.value;

    // Don't broadcast for empty input, or for a leading "/" — that's a slash
    // command or whisper (e.g. /w, /gmroll), which should stay private.
    if (!value.trim() || value.startsWith("/")) return Typing._emit("stop");

    const now = Date.now();
    if (!Typing._broadcasting || now - Typing._lastEmit > THROTTLE_MS) Typing._emit("start");

    clearTimeout(Typing._idleTimer);
    Typing._idleTimer = setTimeout(() => Typing._emit("stop"), IDLE_MS);
  }

  /**
   * Broadcast a typing state change for the local user.
   * @param {"start"|"stop"} state
   */
  static _emit(state) {
    if (state === "start") {
      Typing._broadcasting = true;
      Typing._lastEmit = Date.now();
    } else {
      if (!Typing._broadcasting) return; // nothing in flight to stop
      Typing._broadcasting = false;
      clearTimeout(Typing._idleTimer);
    }
    game.socket.emit(SOCKET, { action: "typing", userId: game.user.id, state });
  }

  /* -------------------------------------------- */
  /* Remote rendering                              */
  /* -------------------------------------------- */

  /**
   * Handle an incoming typing broadcast from another client.
   * @param {{action: string, userId: string, state: "start"|"stop"}} data
   */
  static _onSocket(data) {
    if (!data || data.action !== "typing") return;
    if (data.userId === game.user.id) return; // never show our own indicator

    clearTimeout(Typing._remote.get(data.userId));
    if (data.state === "start") {
      Typing._remote.set(data.userId, setTimeout(() => {
        Typing._remote.delete(data.userId);
        Typing._refresh();
      }, EXPIRE_MS));
    } else {
      Typing._remote.delete(data.userId);
    }
    Typing._refresh();
  }

  /**
   * Repaint every typing indicator from the current remote-typer set.
   */
  static _refresh() {
    const names = [...Typing._remote.keys()]
      .map((id) => game.users.get(id))
      .filter((user) => user?.active)
      .map((user) => user.name);

    const text = Typing._label(names);
    for (const el of document.querySelectorAll(".chatedit-typing-indicator")) {
      el.querySelector(".chatedit-typing-text").textContent = text;
      el.hidden = names.length === 0;
    }
  }

  /**
   * Build the indicator label for a list of typing users.
   * @param {string[]} names
   * @returns {string}
   */
  static _label(names) {
    if (names.length === 0) return "";
    if (names.length === 1) return game.i18n.format("CHATEDIT.TYPING.One", { name: names[0] });
    if (names.length === 2) {
      return game.i18n.format("CHATEDIT.TYPING.Two", { name1: names[0], name2: names[1] });
    }
    return localize("CHATEDIT.TYPING.Many");
  }
}
