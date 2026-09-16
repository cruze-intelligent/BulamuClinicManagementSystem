import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function OfflinePage() {
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6">
      <div className="mx-auto flex min-h-[70vh] max-w-xl items-center">
        <Card className="w-full p-6">
          <p className="text-sm font-medium text-teal-700">Offline mode</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-950 dark:text-slate-50">
            Bulamu is ready for low-connectivity facilities.
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
            Core pages are available from this device. Patient registration and
            local-first workflows can continue offline and sync when connection returns.
          </p>
          <div className="mt-6 flex gap-3">
            <Link href="/patients/register">
              <Button>Register Patient</Button>
            </Link>
            <Link href="/patients">
              <Button variant="outline">View Patients</Button>
            </Link>
          </div>
        </Card>
      </div>
    </main>
  );
}
