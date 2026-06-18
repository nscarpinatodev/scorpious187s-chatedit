
import { ModuleSettings } from "./settings.mjs";
import { ProcessChat } from "./processing.mjs";
import { Editing } from "./editing.mjs";
import { Typing } from "./typing.mjs";

Hooks.once("init", ModuleSettings.init);
Hooks.once("init", Editing.init);
Hooks.once("init", ProcessChat.init);
Hooks.once("init", Typing.init);