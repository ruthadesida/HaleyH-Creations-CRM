import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getUser } from "@/lib/dal";

async function Route() {
  const user = await getUser();
  redirect(user ? "/workspaces" : "/login");
  return null;
}

export default function Home() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <h1 className="sr-only">HaleyH Creations CRM</h1>
      <Suspense>
        <Route />
      </Suspense>
    </main>
  );
}
