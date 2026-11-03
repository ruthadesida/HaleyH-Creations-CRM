"use client";

import { Button } from "@/components/ui/button";

export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      <h1 className="font-display text-3xl font-medium">Something went wrong</h1>
      <p className="text-muted">
        Nothing you entered has been saved unless you saw a confirmation. Check your connection and try again.
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
