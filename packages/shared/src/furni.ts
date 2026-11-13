import { z } from "zod";

export const InteractionSchema = z.enum(["computer", "mailbox", "board", "reception", "elevator", "directory", "door", "build", "review", "tests", "library", "night", "hr", "shop"]);
export type Interaction = z.infer<typeof InteractionSchema>;

export const FurniDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Footprint at dir 0/4. At dir 2/6 w and l swap. */
  w: z.number().int().min(1).max(8),
  l: z.number().int().min(1).max(8),
  /** Visual height in height units. */
  height: z.number().min(0).max(9),
  walkable: z.boolean(),
  interaction: InteractionSchema.optional(),
  /** `wall`: the piece hugs a back wall (furni-move); absent means it stands on the floor. */
  mount: z.literal("wall").optional(),
  /** One line shown in the hover tooltip; every interactive item has one. */
  hint: z.string().min(1).max(80).optional(),
  /** Id of the procedural draw recipe used by the client. */
  draw: z.string().min(1),
});
export type FurniDef = z.infer<typeof FurniDefSchema>;

function def(
  id: string,
  name: string,
  w: number,
  l: number,
  height: number,
  walkable: boolean,
  interaction?: Interaction,
  hint?: string,
  mount?: "wall",
): FurniDef {
  return FurniDefSchema.parse({
    id,
    name,
    w,
    l,
    height,
    walkable,
    draw: id,
    ...(interaction ? { interaction } : {}),
    ...(hint ? { hint } : {}),
    ...(mount ? { mount } : {}),
  });
}

const DEFS: FurniDef[] = [
  def("computer_desk", "Computer desk", 2, 1, 2, false, "computer", "Give the agents a job"),
  def("mailbox", "Mailbox", 1, 1, 3, false, "mailbox", "Approve plans and read reports", "wall"),
  def("board", "Job board", 2, 1, 4, false, "board", "Timeline of the current job", "wall"),
  def("reception_desk", "Reception desk", 2, 1, 2, false, "reception", "Register and manage projects"),
  def("elevator", "Elevator", 2, 1, 5, false, "elevator", "Take the elevator to another floor"),
  def("directory_board", "Floor directory", 2, 1, 4, false, "directory", "See every floor and what is happening on it"),
  def("construction_board", "Construction board", 2, 1, 4, false, "build", "What is being built and what waits for you"),
  def("review_desk", "Review desk", 1, 1, 3, false, "review", "Have the team review one of your branches", "wall"),
  def("test_lab", "Test lab", 1, 1, 3, false, "tests", "Have the team write tests for a module", "wall"),
  def("library_shelf", "Library shelf", 1, 1, 4, false, "library", "Have the team document a topic or path", "wall"),
  def("night_board", "Night board", 1, 1, 4, false, "night", "Schedule jobs for the night shift"),
  def("hr_desk", "HR desk", 2, 1, 2, false, "hr", "Hire, rename and fire agents, and import new ones"),
  def("shop_counter", "Shop counter", 2, 1, 2.5, false, "shop", "Spend your Ecto on furniture"),
  def("door", "Door", 1, 1, 5, false, "door", "Go through the door"),
  def("agent_desk", "Agent desk", 2, 1, 2, false),
  def("chair", "Chair", 1, 1, 2, true),
  def("plant", "Potted plant", 1, 1, 4, false),
  def("lamp", "Floor lamp", 1, 1, 5, false),
  def("sofa", "Sofa", 2, 1, 2, false),
  def("jack_o_lantern_lamp", "Jack-o'-lantern lamp", 1, 1, 2, false),
  def("cobweb", "Cobweb", 1, 1, 0, true),
  // Sold in the shop (furni-shop): decorative only, no interaction, no hint. The names are our own.
  // Seating
  def("armchair", "Velvet armchair", 1, 1, 2.4, false),
  def("bench", "Crypt bench", 2, 1, 1.6, false),
  def("beanbag", "Beanbag", 1, 1, 1.2, false),
  def("throne", "Bone throne", 1, 1, 4.4, false),
  // Tables
  def("side_table", "Side table", 1, 1, 1.6, false),
  def("coffee_table", "Coffee table", 2, 1, 1.2, false),
  def("round_table", "Round table", 2, 2, 1.8, false),
  def("potion_bar", "Potion bar", 3, 1, 2.2, false),
  // Lights
  def("candelabra", "Candelabra", 1, 1, 3.6, false),
  def("floor_torch", "Floor torch", 1, 1, 5, false),
  def("lava_lamp", "Lava lamp", 1, 1, 2.4, false),
  def("crystal_ball", "Crystal ball", 1, 1, 2.2, false),
  // Plants
  def("fern", "Fern", 1, 1, 3.2, false),
  def("palm", "Palm", 1, 1, 5.5, false),
  def("cactus", "Cactus", 1, 1, 3, false),
  def("bonsai", "Bonsai", 1, 1, 2.2, false),
  // Spooky
  def("gravestone", "Gravestone", 1, 1, 3, false),
  def("coffin", "Coffin", 2, 1, 2, false),
  def("cauldron", "Cauldron", 1, 1, 2.4, false),
  def("skeleton", "Standing skeleton", 1, 1, 4.6, false),
  def("rune_rug", "Rune rug", 2, 2, 0.1, true),
  // Walls
  def("wall_clock", "Wall clock", 1, 1, 4, false, undefined, undefined, "wall"),
  def("moon_poster", "Moon poster", 1, 1, 4, false, undefined, undefined, "wall"),
  def("tall_mirror", "Tall mirror", 1, 1, 4.6, false, undefined, undefined, "wall"),
  def("banner", "Hanging banner", 1, 1, 5, false, undefined, undefined, "wall"),
];

export const FURNI_CATALOG: Readonly<Record<string, FurniDef>> = Object.freeze(
  Object.fromEntries(DEFS.map((d) => [d.id, d])),
);

export function getFurniDef(id: string): FurniDef | undefined {
  return FURNI_CATALOG[id];
}
