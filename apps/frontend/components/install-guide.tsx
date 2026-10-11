'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Download, Laptop, MonitorSmartphone, Smartphone, Tablet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  detectPlatform, getInstallPrompt, INSTALL_PROMPT_EVENT, isInstalled, promptInstall, type InstallPlatform,
} from '@/lib/install-prompt';

const PLATFORMS: Array<{ id: InstallPlatform; label: string; icon: typeof Smartphone; steps: string[] }> = [
  {
    id: 'android',
    label: 'Android phone or tablet',
    icon: Smartphone,
    steps: [
      'Open bulamu.site in Google Chrome.',
      'Tap the Install app button (bottom right of the screen, or on this page) - or tap the ⋮ menu at the top right and choose Install app (on some phones: Add to Home screen).',
      'Tap Install to confirm. Bulamu appears on your home screen and in your app list.',
      'Open it from the home screen and sign in once while you have internet.',
    ],
  },
  {
    id: 'ios',
    label: 'iPhone or iPad',
    icon: Tablet,
    steps: [
      'Open bulamu.site in Safari (other browsers on iPhone cannot install apps).',
      'Tap the Share button - the square with an arrow pointing up, at the bottom of the screen (top right on iPad).',
      'Scroll down and tap Add to Home Screen, then tap Add.',
      'Open Bulamu from the home screen and sign in once while you have internet.',
    ],
  },
  {
    id: 'desktop',
    label: 'Computer (Windows, Mac, Chromebook)',
    icon: Laptop,
    steps: [
      'Open bulamu.site in Google Chrome or Microsoft Edge.',
      'Click the Install app button on this page, or the install icon at the right end of the address bar (a screen with a down arrow).',
      'Click Install. Bulamu opens in its own window and gets a desktop / Start menu shortcut.',
      'Sign in once while you have internet.',
    ],
  },
];

const AFTER_INSTALL = [
  'Sign in on each device while online at least once - after that the app opens and records can be saved without internet.',
  'The badge at the bottom right shows "Synced", "Offline" or how many saved changes are waiting to be sent. They go up by themselves when the connection returns.',
  'Tick "Keep me signed in for 30 days" only on a device that is yours. On a shared computer, sign out when you finish.',
  'Never clear the browser\'s data, or uninstall the app, while changes are waiting to be sent - they are only on that device until then.',
  'Updates arrive by themselves - there is nothing to download from an app store.',
];

/** Step-by-step instructions for installing Bulamu, for the device in hand first. */
export function InstallGuide({ id = 'install' }: { id?: string }) {
  const [platform, setPlatform] = useState<InstallPlatform>('android');
  const [canPrompt, setCanPrompt] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform(navigator.userAgent, navigator.maxTouchPoints));
    setInstalled(isInstalled());
    const promptChanged = () => setCanPrompt(getInstallPrompt() !== null);
    const appInstalled = () => setInstalled(true);
    promptChanged();
    window.addEventListener(INSTALL_PROMPT_EVENT, promptChanged);
    window.addEventListener('appinstalled', appInstalled);
    return () => {
      window.removeEventListener(INSTALL_PROMPT_EVENT, promptChanged);
      window.removeEventListener('appinstalled', appInstalled);
    };
  }, []);

  const install = async () => {
    if (await promptInstall()) setInstalled(true);
  };

  const ordered = [...PLATFORMS].sort((a, b) => Number(b.id === platform) - Number(a.id === platform));

  return (
    <Card id={id} className="scroll-mt-20 gap-5 rounded-lg p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-emerald-700 text-white">
            <MonitorSmartphone className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Install Bulamu on your device</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
              Bulamu installs straight from the browser - no app store needed. Installed, it opens like any other app and keeps
              working without internet.
            </p>
          </div>
        </div>
        {installed ? (
          <p className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Installed on this device
          </p>
        ) : canPrompt ? (
          <Button type="button" onClick={install} className="shrink-0">
            <Download className="size-4" aria-hidden="true" />
            Install app
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {ordered.map((item) => (
          <section
            key={item.id}
            aria-label={item.label}
            className={`rounded-lg border p-4 ${item.id === platform ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20' : 'border-slate-200 dark:border-slate-800'}`}
          >
            <h3 className="flex items-center gap-2 font-medium text-slate-950 dark:text-slate-50">
              <item.icon className="size-4 text-emerald-700" aria-hidden="true" />
              {item.label}
              {item.id === platform && <span className="rounded bg-emerald-700 px-1.5 py-0.5 text-xs font-medium text-white">This device</span>}
            </h3>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600 dark:text-slate-400">
              {item.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </section>
        ))}
      </div>

      <div>
        <h3 className="font-medium text-slate-950 dark:text-slate-50">After installing</h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-slate-600 dark:text-slate-400">
          {AFTER_INSTALL.map((tip) => <li key={tip}>{tip}</li>)}
        </ul>
      </div>
    </Card>
  );
}
