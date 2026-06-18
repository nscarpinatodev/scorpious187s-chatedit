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

    // The chat composer (#chat-message) is rendered apart from the chat log and
    // re-parented as the sidebar/popout state changes, so (re)place the
    // indicator on each of these triggers. Hook names that don't exist simply
    // never fire — harmless.
    for (const hook of ["renderChatInput", "renderChatLog", "changeSidebarTab", "collapseSidebar"]) {
      Hooks.on(hook, () => Typing._place());
    }
    Hooks.once("ready", () => Typing._place());

    // Stop broadcasting the moment a message is actually sent from the input.
    Hooks.on("chatMessage", () => Typing._emit("stop"));
  }

  /* -------------------------------------------- */
  /* Local typing detection                        */
  /* -------------------------------------------- */

  /**
   * (Re)place a typing indicator directly above every chat composer in the DOM
   * and wire input listeners. The chat input (#chat-message) is rendered apart
   * from the chat log and re-parented as the sidebar/popout state changes, so
   * this runs on every relevant render hook and follows the input.
   */
  static _place() {
    const inputs = document.querySelectorAll("#chat-message, textarea[name='chat-message']");
    for (const textarea of inputs) {
      const anchor = textarea.closest("form, .chat-form, .chat-input, fieldset") ?? textarea;

      // Reuse an indicator already sitting above this input, else create one.
      let indicator = anchor.previousElementSibling;
      if (!indicator?.classList?.contains("chatedit-typing-indicator")) {
        indicator = Typing._createIndicator();
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
    }

    Typing._refresh();
  }

  /**
   * Build a hidden typing-indicator element.
   * @returns {HTMLDivElement}
   */
  static _createIndicator() {
    const el = document.createElement("div");
    el.className = "chatedit-typing-indicator";
    el.hidden = true;
    el.innerHTML =
      '<span class="chatedit-typing-dots"><i></i><i></i><i></i></span>' +
      '<span class="chatedit-typing-text"></span>';
    return el;
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
