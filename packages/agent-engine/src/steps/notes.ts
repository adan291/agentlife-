const MAX_JOBS = 200;
const MAX_NOTES_PER_JOB = 10;

/**
 * Things a report must say that the job's steps know and the report step does not: today, that the local intern could
 * not run and another model did the work. Kept in memory for the jobs in flight (a job that was running when the engine
 * stopped is failed on restart, and its failure report does not carry them). The texts are written by the engine from
 * fixed templates with model names, never from model output.
 */
export class JobNotes {
  private readonly notes = new Map<string, string[]>();

  add(taskId: string, text: string): void {
    const list = this.notes.get(taskId) ?? [];
    if (list.includes(text) || list.length >= MAX_NOTES_PER_JOB) return;
    list.push(text);
    this.notes.set(taskId, list);
    if (this.notes.size > MAX_JOBS) {
      const oldest = this.notes.keys().next().value;
      if (oldest !== undefined) this.notes.delete(oldest);
    }
  }

  get(taskId: string): readonly string[] {
    return this.notes.get(taskId) ?? [];
  }

  clear(taskId: string): void {
    this.notes.delete(taskId);
  }
}
