/**
 * Background music: one looping track shared by the whole app.
 *
 * Put the track at client/public/music/theme.mp3 (Vite serves anything in
 * public/ as-is). To use a different name or format, change TRACK below.
 *
 * Browsers refuse to play sound until the player has clicked or pressed a
 * key on the page, so App starts the music on the first interaction.
 */

const TRACK = `${import.meta.env.BASE_URL}music/theme.mp3`;
const VOLUME = .59; // 0 is silent, 1 is full volume
const PREF_KEY = "freebound.music";

let audio: HTMLAudioElement | null = null;

function player(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(TRACK);
    audio.loop = true;
    audio.volume = VOLUME;
    audio.preload = "auto";
  }
  return audio;
}

export function startMusic() {
  // play() is refused before the first interaction, or if the file is
  // missing; either way the game carries on silently.
  player()
    .play()
    .catch(() => {});
}

export function stopMusic() {
  audio?.pause();
}

/** Music is on unless this browser has muted it before. */
export function loadMusicPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveMusicPref(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    // Storage can be unavailable (private mode); the button still works for this visit.
  }
}