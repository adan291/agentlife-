import { z } from "zod";

/** Limits on a project that is registered in the hotel (project-registry, requirement 1.3). */
export const MAX_PROJECT_FILES = 20_000;
export const MAX_PROJECT_BYTES = 200 * 1024 * 1024;

export const PROJECT_NAME_MAX = 60;
export const PROJECT_PATH_MAX = 500;
export const PROJECT_TEST_COMMAND_MAX = 200;

/** `node-npm`: package.json and package-lock.json at the root. Anything else has no supported test setup. */
export const ProjectStackSchema = z.enum(["node-npm", "unsupported-tests"]);
export type ProjectStack = z.infer<typeof ProjectStackSchema>;

/**
 * What clients may know about a project. The absolute path is never part of it (requirement 2): it lives only in the
 * engine's `data/projects.json`.
 */
export const ProjectSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(60),
  name: z.string().min(1).max(PROJECT_NAME_MAX),
  stack: ProjectStackSchema,
  /** Empty for `unsupported-tests`: the test step is skipped. */
  testCommand: z.string().max(PROJECT_TEST_COMMAND_MAX),
  /** The fixture repository from config/repos.json: it cannot be removed and cannot be delivered. */
  builtin: z.boolean(),
  /** Epoch ms; 0 for the built-in project. */
  registeredAt: z.number().int().nonnegative(),
});
export type Project = z.infer<typeof ProjectSchema>;

/** One line must not hold a newline or NUL: the command runs in `sh -c` inside the test sandbox. */
const TestCommandSchema = z
  .string()
  .trim()
  .max(PROJECT_TEST_COMMAND_MAX)
  .regex(/^[^\r\n\0]*$/, "must be a single line");

export const RegisterProjectBodySchema = z.object({
  path: z.string().trim().min(1).max(PROJECT_PATH_MAX),
  name: z.string().trim().min(1).max(PROJECT_NAME_MAX),
  /** Blank or absent: the default of the detected stack (`npm test` for node-npm). */
  testCommand: TestCommandSchema.optional(),
  /** Repeat the request with `true` after the user has seen the findings. */
  acceptFindings: z.boolean().optional(),
});
export type RegisterProjectBody = z.infer<typeof RegisterProjectBodySchema>;

export const FINDINGS_SHOWN_MAX = 30;

/** A scanner finding as shown to the user: the value is masked, `where` is a path inside the project. */
export const LeakFindingViewSchema = z.object({
  severity: z.enum(["high", "medium", "low"]),
  kind: z.string().min(1).max(60),
  masked: z.string().max(100),
  where: z.string().max(300),
  /** Number of places where the same value was found. */
  count: z.number().int().positive(),
});
export type LeakFindingView = z.infer<typeof LeakFindingViewSchema>;

/** Reasons why a registration is refused. The message names the rule, never the path. */
export const RegisterErrorCodeSchema = z.enum([
  "invalid_path",
  "path_not_found",
  "not_a_directory",
  "outside_allowed_roots",
  "not_a_git_repo",
  "no_commits",
  "detached_head",
  "is_agentlife",
  "too_many_files",
  "too_large",
  "already_registered",
  "invalid_name",
]);
export type RegisterErrorCode = z.infer<typeof RegisterErrorCodeSchema>;

export const RegisterProjectResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), project: ProjectSchema }),
  z.object({
    status: z.literal("needs_acceptance"),
    findings: z.array(LeakFindingViewSchema).max(FINDINGS_SHOWN_MAX),
    /** Distinct findings in total (the list above is cut at 30). */
    total: z.number().int().positive(),
  }),
  z.object({ status: z.literal("error"), code: RegisterErrorCodeSchema, message: z.string().min(1).max(500) }),
]);
export type RegisterProjectResult = z.infer<typeof RegisterProjectResultSchema>;

/** Delivery of a job's branch to the user's repository (requirement 5). */
export const DeliveryInfoSchema = z.object({
  branch: z.string().min(1).max(200),
  commit: z.string().min(1).max(64),
});
export type DeliveryInfo = z.infer<typeof DeliveryInfoSchema>;
