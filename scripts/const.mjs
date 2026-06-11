export const MODULE = "scorpious187s-chatedit";
export const CHATEDIT_CONST = {
  CHAT_MESSAGE_STYLES: {
    EMOTE: 3,
    IC: 2,
    OOC: 1,
    OTHER: 0
  }
};
export const SETTINGS = {
  EDIT: "allowEdit",
  MARKDOWN: "markdown",
  SHOW: "showEdited"
};
export const localize = (key) => game.i18n.localize(key);

/**
 * Whether Foundry's bundled Showdown markdown converter is available.
 * Guards the markdown code paths so the module degrades gracefully if it ever
 * stops being exposed as a global (e.g. a future Foundry release).
 * @returns {boolean}
 */
export const hasShowdown = () => typeof showdown !== "undefined";
