// The subathon timer editor page: the look and the rules, a preview clock with the Start, Pause and add-time buttons, and the link. The preview
// keeps its own clock; the same buttons also send the command to the overlay in the streaming app (through the post box in worker/timer.mjs).

import { TIMER, SubTimer, formatClock } from "./timer.js";
import { createTimerView } from "./widgets-view.js";
import { startWidgetEditor } from "./widget-editor.js";
import { sendCommand, timerIdentity } from "./timer-bridge.js";
import { fakeAlert } from "./fake-alerts.js";

startWidgetEditor({
  widget: TIMER,
  storeKey: "frills:timer:v1",
  overlayPath: "/overlay/timer/",
  events: ["gift", "follow", "share"],
  idleHint: "Type your TikTok name, or frills_demo to get made-up gifts. The buttons above work without connecting.",
  create(host, settings) {
    const view = createTimerView(host);
    const identity = timerIdentity();
    settings.code = identity.code; // the code rides in the link by itself; the key never leaves this browser
    const timer = new SubTimer(settings, { onAdd: (seconds) => view.pop(seconds) });
    const sent = document.getElementById("timer-sent");
    let current = settings;
    view.apply(settings);
    const draw = () => {
      const now = Date.now();
      timer.tick(now);
      view.render({ text: formatClock(timer.remaining(now), current.hours), status: timer.state(now) });
    };
    draw();
    setInterval(draw, 250);
    // A button does two things: it moves the preview clock, and it tells the overlay in the streaming app (which keeps the real clock).
    async function command(cmd, value = 0) {
      timer.command({ cmd, value }, Date.now());
      draw();
      if (sent) sent.textContent = "Sending to your overlay…";
      const result = await sendCommand(identity, { cmd, value });
      if (sent) sent.textContent = result.ok ? "Sent. Your overlay in the streaming app obeys it within a few seconds." : "Could not reach your overlay's controls (" + result.error + "). The preview moved, the overlay did not.";
    }
    return {
      apply(next) { next.code = identity.code; current = next; view.apply(next); timer.setSettings(next); draw(); },
      onEvent: (event) => { timer.handle(event, Date.now()); draw(); },
      tests: {
        start: () => command("start"),
        pause: () => command("pause"),
        resume: () => command("resume"),
        reset: () => command("reset"),
        minute: () => command("add", 60),
        five: () => command("add", 300),
        less: () => command("add", -60),
        gift: () => { timer.handle(fakeAlert("gift"), Date.now()); draw(); },
        follow: () => { timer.handle(fakeAlert("follow"), Date.now()); draw(); },
      },
    };
  },
});
