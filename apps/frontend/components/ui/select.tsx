import * as React from "react"

import { cn } from "@/lib/utils"

// A native <select> styled to match Input. Native is deliberate: it is fully
// keyboard and screen-reader accessible, and it opens the platform's own picker
// on phones. Colours for the open list come from globals.css so they follow the
// light/dark theme.
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "border-input bg-background text-foreground dark:bg-input/30 h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Select }
