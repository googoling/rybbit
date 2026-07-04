// Slug/event → human-readable labels. Pure in-memory lookups (no I/O). See SPEC.md.

export const TOOL_LABELS: Record<string, string> = {
  "room-redesign": "Room Redesign",
  "kitchen-redesign": "Kitchen Redesign",
  "bathroom-redesign": "Bathroom Redesign",
  "exterior-redesign": "Exterior Redesign",
  "landscape-redesign": "Landscape Redesign",
  "sketch-to-render": "Sketch to Render",
  "floor-plan-to-3d": "Floor Plan to 3D",
  "magic-edit": "Magic Edit",
  generate: "Generate",
};

// Tool page pathnames we roll up into intent (everything else is dropped).
export const TOOL_PATHNAMES = Object.keys(TOOL_LABELS);

export function toolLabel(slug: string | undefined | null): string {
  if (!slug) return "";
  const clean = slug.replace(/^\/(beta\/)?/, "").replace(/\/$/, "");
  return TOOL_LABELS[clean] || clean.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// Milestones we track, in lifecycle order (furthest-step ranking uses this order).
export const MILESTONES = [
  "signup_started",
  "signup_verified",
  "email_verified",
  "first_design_generated",
  "pricing_viewed",
  "checkout_started",
  "checkout_completed",
] as const;
export type Milestone = (typeof MILESTONES)[number];

export const FURTHEST_STEP_LABELS: Record<Milestone, string> = {
  signup_started: "Started signup",
  signup_verified: "Verified signup",
  email_verified: "Verified email",
  first_design_generated: "Generated first design",
  pricing_viewed: "Viewed pricing",
  checkout_started: "Started checkout",
  checkout_completed: "Completed checkout",
};

// Structured meta for the event — Mailbo renders up to 3 keys as a detail line,
// and its agent/sequences can filter on the stable `milestone` key.
export function milestoneMeta(
  m: Milestone,
  ctx: { tool?: string; plan?: string; price?: number | string } = {}
): Record<string, unknown> {
  const base: Record<string, unknown> = { milestone: m };
  if (m === "first_design_generated" && ctx.tool) base.tool = toolLabel(ctx.tool);
  if (m === "checkout_started") {
    if (ctx.plan) base.plan = ctx.plan;
    if (ctx.price) base.price = ctx.price;
  }
  return base;
}

export function milestoneTitle(m: Milestone, ctx: { tool?: string; plan?: string; price?: number | string } = {}): string {
  switch (m) {
    case "signup_started":
      return "Started signup";
    case "signup_verified":
      return "Verified signup";
    case "email_verified":
      return "Verified email address";
    case "first_design_generated":
      return ctx.tool ? `Generated first design — ${toolLabel(ctx.tool)}` : "Generated first design";
    case "pricing_viewed":
      return "Viewed pricing";
    case "checkout_started":
      return ctx.plan ? `Started checkout — ${ctx.plan}${ctx.price ? ` ($${ctx.price})` : ""}` : "Started checkout";
    case "checkout_completed":
      return "Completed checkout";
  }
}
