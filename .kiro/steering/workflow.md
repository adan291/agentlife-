# Working protocol (every session)

This project is built across many Kiro sessions. A new session has no memory of previous ones, so the repository is the memory.

## Start of session
1. Read the current status below (docs/STATUS.md) and the spec named in the user's request.
2. Work only on the tasks the user asked for, in order. Do not start the next spec on your own.
3. Work on a branch named after the spec: `feat/<spec-name>`. Create it from `main` if it does not exist.

## While working
- Follow the spec's design.md. If the design turns out wrong, stop and tell the user before changing the approach; record any accepted change in the spec's design.md and, if architectural, in docs/risks-and-decisions.md.
- Mark a task done in tasks.md only after `pnpm check` passes and the task's acceptance criteria are met.
- Keep commits small, one per task, message `<spec>: <task number> <summary>`.

## End of session
1. `pnpm check` must pass.
2. Update docs/STATUS.md: what was done, what is next, open problems. When the session talked with the user (IDE chat), add one dated line to ## Last conversation with the user (what was asked, decided and left pending), so a Discord session can continue the thread.
3. Commit. Do not push or merge unless the user asks.

## Current status
#[[file:docs/STATUS.md]]
