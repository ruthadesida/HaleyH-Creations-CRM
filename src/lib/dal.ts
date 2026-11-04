import "server-only";
import { io } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { Database } from "./supabase/database.types";
import { createClient } from "./supabase/server";

/**
 * Data Access Layer: the one place that answers "who is this, and what may they do?".
 * Every page and Server Action goes through it. RLS in the database is the final guard.
 */

export type Role = Database["public"]["Enums"]["member_role"];
export type Business = Pick<
  Database["public"]["Tables"]["businesses"]["Row"],
  "id" | "name" | "slug" | "currency" | "timezone" | "is_demo" | "order_prefix" | "stage_labels"
>;

export type SessionUser = { id: string; email: string };

export const getUser = cache(async (): Promise<SessionUser | null> => {
  // Verifying the session compares the token expiry with the clock: always do it at request time,
  // never while Next prepares a shared page shell.
  await io();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export type Workspace = { business: Business; role: Role; user: SessionUser };

/** Loads a workspace the signed-in user actively belongs to, or 404s. */
export const getWorkspace = cache(async (slug: string): Promise<Workspace> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("businesses")
    .select(
      "id, name, slug, currency, timezone, is_demo, order_prefix, stage_labels, memberships!inner(role, status, user_id)",
    )
    .eq("slug", slug)
    .eq("memberships.user_id", user.id)
    .eq("memberships.status", "active")
    .is("archived_at", null)
    .maybeSingle();

  if (!data) notFound();
  const { memberships, ...business } = data;
  return { business, role: memberships[0].role, user };
});

/** Mirrors the database role helpers (app.is_office, app.is_production, app.is_owner). */
export const can = {
  /** Front office work: customers, enquiries, sales orders, payment records. */
  office: (role: Role) => role === "owner" || role === "front_office",
  /** Production and stock work: materials, makers, locations, transfers, counts. */
  production: (role: Role) => role === "owner" || role === "production_manager",
  /** Corrections, refunds, voids, prices, approvals, archiving customers. */
  manage: (role: Role) => role === "owner",
  /** Staff, permissions and business settings. */
  own: (role: Role) => role === "owner",
};

/** For pages: like `authorize`, but shows the 404 page instead of throwing. */
export async function pageWorkspace(slug: string, check: (role: Role) => boolean = can.office) {
  const ws = await getWorkspace(slug);
  if (!check(ws.role)) notFound();
  return ws;
}

/** For Server Actions: re-checks session, membership and role on every call. */
export async function authorize(slug: string, check: (role: Role) => boolean = can.office) {
  const ws = await getWorkspace(slug);
  if (!check(ws.role)) {
    throw new Error("You don't have permission to do that.");
  }
  return ws;
}
