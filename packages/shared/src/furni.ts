import { z } from "zod";

export const InteractionSchema = z.enum(["computer", "mailbox", "board", "reception", "elevator", "directory", "door", "build", "review", "tests", "library", "night", "hr"]);
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
  def("door", "Door", 1, 1, 5, false, "door", "Go through the door"),
  def("agent_desk", "Agent desk", 2, 1, 2, false),
  def("chair", "Chair", 1, 1, 2, true),
  def("plant", "Potted plant", 1, 1, 4, false),
  def("lamp", "Floor lamp", 1, 1, 5, false),
  def("sofa", "Sofa", 2, 1, 2, false),
  def("jack_o_lantern_lamp", "Jack-o'-lantern lamp", 1, 1, 2, false),
  def("cobweb", "Cobweb", 1, 1, 0, true),
];

export const FURNI_CATALOG: Readonly<Record<string, FurniDef>> = Object.freeze(
  Object.fromEntries(DEFS.map((d) => [d.id, d])),
);

export function getFurniDef(id: string): FurniDef | undefined {
  return FURNI_CATALOG[id];
}
