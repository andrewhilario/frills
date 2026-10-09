// Draws the stage on the share-image page: the Butter look, with a fixed set of messages and no motion.

import { Feed } from "./feed.js";
import { SAMPLE_MESSAGES } from "./fake.js";
import { PRESETS, sanitize } from "./settings.js";
import { paintGeneral } from "./look.js";

const stage = document.getElementById("og-stage");
const options = paintGeneral(stage, sanitize(PRESETS.butter));
new Feed(stage.querySelector(".chatbox"), options).fill([
  ...SAMPLE_MESSAGES,
  { id: "s4", user: "pondpal", name: "pondpal", text: "this overlay is so cute" },
]);
