// The browser's "install this app" offer (Chrome, Edge, Android), kept where
// both the floating Install button and the install guide can use it.

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export const INSTALL_PROMPT_EVENT = 'bulamu-install-prompt';

let deferred: BeforeInstallPromptEvent | null = null;

export function setInstallPrompt(event: BeforeInstallPromptEvent | null) {
  deferred = event;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(INSTALL_PROMPT_EVENT));
}

export function getInstallPrompt() {
  return deferred;
}

/** Shows the browser's install dialog. True if the person installed it. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  await event.prompt();
  const { outcome } = await event.userChoice;
  setInstallPrompt(null);
  return outcome === 'accepted';
}

/** Already running as the installed app. */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export type InstallPlatform = 'android' | 'ios' | 'desktop';

/** iPads present themselves as a Mac; touch support gives them away. */
export function detectPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'desktop';
}
