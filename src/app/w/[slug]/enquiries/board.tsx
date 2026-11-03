"use client";

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { Sheet } from "@/app/w/[slug]/nav";
import { Chip } from "@/components/ui/bits";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { ENQUIRY_STAGE_LABEL } from "@/lib/labels";
import { moveEnquiry } from "./actions";

export type BoardCard = {
  id: string;
  stage: Stage;
  position: number;
  customer: string;
  interest: string | null;
  followUp: string | null;
  overdue: boolean;
  hasOrder: boolean;
};
type Stage = "new" | "contacted" | "choosing" | "awaiting_payment" | "won" | "lost";
const COLUMNS: Stage[] = ["new", "contacted", "choosing", "awaiting_payment", "won", "lost"];

export function PipelineBoard({ slug, cards }: { slug: string; cards: BoardCard[] }) {
  const [optimistic, apply] = useOptimistic(cards, (state, move: { id: string; stage: Stage; position: number }) =>
    state.map((c) => (c.id === move.id ? { ...c, stage: move.stage, position: move.position } : c)),
  );
  const [, start] = useTransition();
  const [dragging, setDragging] = useState<BoardCard | null>(null);
  const [lostFor, setLostFor] = useState<{ card: BoardCard; position: number } | null>(null);
  const [wonCard, setWonCard] = useState<BoardCard | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Touch: press and hold briefly so vertical scrolling still works.
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byStage = (s: Stage) => optimistic.filter((c) => c.stage === s).sort((a, b) => a.position - b.position);

  function commit(card: BoardCard, stage: Stage, position: number, lostReason?: string) {
    start(async () => {
      apply({ id: card.id, stage, position });
      const r = await moveEnquiry(slug, { id: card.id, stage, position, lost_reason: lostReason });
      if (!r.ok) toast.error(r.message);
      else if (stage === "won" && !card.hasOrder) setWonCard(card);
    });
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const card = optimistic.find((c) => c.id === e.active.id);
    if (!card || !e.over) return;
    const overId = String(e.over.id);
    const overCard = optimistic.find((c) => c.id === overId);
    const stage = (overCard ? overCard.stage : overId.replace("col:", "")) as Stage;
    if (!COLUMNS.includes(stage)) return;

    // Position: just above the card dropped on, or at the end of the column.
    const column = byStage(stage).filter((c) => c.id !== card.id);
    let position: number;
    if (overCard && overCard.id !== card.id) {
      const idx = column.findIndex((c) => c.id === overCard.id);
      const before = column[idx - 1]?.position ?? overCard.position - 1;
      position = (before + overCard.position) / 2;
    } else {
      position = (column.at(-1)?.position ?? 0) + 1;
    }
    if (stage === card.stage && position === card.position) return;

    if (stage === "lost" && card.stage !== "lost") {
      setLostFor({ card, position });
      return;
    }
    commit(card, stage, position);
  }

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCorners}
        onDragStart={(e: DragStartEvent) => setDragging(optimistic.find((c) => c.id === e.active.id) ?? null)}
        onDragCancel={() => setDragging(null)}
        onDragEnd={onDragEnd}
        accessibility={{
          screenReaderInstructions: { draggable: "Press space to pick up this enquiry, use the arrow keys to move it between stages, then press space to drop it." },
        }}>
        {/* Columns scroll sideways on phones with snap; on wide screens all six fit. */}
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 [scrollbar-width:thin] sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 2xl:grid 2xl:grid-cols-6 2xl:overflow-visible">
          {COLUMNS.map((stage) => (
            <Column key={stage} stage={stage} cards={byStage(stage)} slug={slug} />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}>
          {dragging && <CardBody card={dragging} lifted />}
        </DragOverlay>
      </DndContext>

      <Drawer.Root open={!!lostFor} onOpenChange={(o) => !o && setLostFor(null)}>
        <Sheet title="Why was it lost?">
          <form className="flex flex-col gap-4" onSubmit={(e) => {
            e.preventDefault();
            const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
            if (!reason || !lostFor) return;
            commit(lostFor.card, "lost", lostFor.position, reason);
            setLostFor(null);
          }}>
            <Field label="Reason" htmlFor="lost-reason" hint="e.g. Price, timing, found elsewhere, no reply">
              <Input id="lost-reason" name="reason" required autoFocus />
            </Field>
            <Button type="submit" size="lg" block>Mark as lost</Button>
          </form>
        </Sheet>
      </Drawer.Root>

      <Drawer.Root open={!!wonCard} onOpenChange={(o) => !o && setWonCard(null)}>
        <Sheet title="Enquiry won">
          <p className="mb-4 text-muted">Create the order for {wonCard?.customer} now? Their details carry over.</p>
          <div className="flex flex-col gap-2">
            <ButtonLink href={`/w/${slug}/orders/new?enquiry=${wonCard?.id}`} variant="gold" size="lg" block>Create order</ButtonLink>
            <Button variant="ghost" block onClick={() => setWonCard(null)}>Later</Button>
          </div>
        </Sheet>
      </Drawer.Root>
    </>
  );
}

function Column({ stage, cards, slug }: { stage: Stage; cards: BoardCard[]; slug: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${stage}` });
  return (
    <section aria-label={ENQUIRY_STAGE_LABEL[stage]}
      className={cn("flex w-[78vw] max-w-[300px] shrink-0 snap-start flex-col rounded-[var(--radius-card)] bg-ink/[0.035] sm:w-[280px] 2xl:w-auto 2xl:max-w-none",
        isOver && "bg-gold-soft")}>
      <header className="flex items-center justify-between px-3 pt-3 pb-2">
        <h2 className="text-sm font-semibold">{ENQUIRY_STAGE_LABEL[stage]}</h2>
        <span className="tabular text-sm text-muted">{cards.length}</span>
      </header>
      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="flex min-h-24 flex-col gap-2 px-2 pb-2">
          {cards.map((c) => <SortableCard key={c.id} card={c} slug={slug} />)}
          {cards.length === 0 && <li className="rounded-lg border border-dashed border-line-strong px-3 py-6 text-center text-sm text-muted">Drop here</li>}
        </ul>
      </SortableContext>
    </section>
  );
}

function SortableCard({ card, slug }: { card: BoardCard; slug: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("touch-manipulation", isDragging && "opacity-40")} {...attributes} {...listeners}>
      <Link href={`/w/${slug}/enquiries/${card.id}`} draggable={false} className="block">
        <CardBody card={card} />
      </Link>
    </li>
  );
}

function CardBody({ card, lifted }: { card: BoardCard; lifted?: boolean }) {
  return (
    <div className={cn("no-select rounded-lg border border-line bg-surface p-3 transition-shadow duration-150",
      lifted && "rotate-[1.5deg] shadow-[0_16px_32px_-12px_rgba(35,33,30,0.4)]")}>
      <p className="truncate font-medium">{card.customer}</p>
      {card.interest && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{card.interest}</p>}
      {card.followUp && (
        <Chip tone={card.overdue ? "danger" : "neutral"} className="mt-2">{card.followUp}</Chip>
      )}
    </div>
  );
}
