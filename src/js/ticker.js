// A clock that keeps ticking when its tab is in the background. A page's own timers are slowed down (to once a second, then once a minute)
// when its tab is hidden; a worker's messages are not, so the Spotify tab keeps sharing the song while the streamer is looking at OBS.
let timer = 0;
self.onmessage = (event) => {
  clearInterval(timer);
  const every = Number(event.data?.every);
  if (every > 0) timer = setInterval(() => self.postMessage(1), every);
};
