// A tiny client-side work queue for filling extraction-table cells. Work is
// grouped per paper (one model call fills all requested columns for a paper)
// and at most `concurrency` papers are processed at once.

export interface ExtractionTask {
  paperId: string;
  columnIds: string[];
}

export class ExtractionQueue {
  private waiting: ExtractionTask[] = [];
  private active = 0;

  constructor(
    private readonly run: (task: ExtractionTask) => Promise<void>,
    private readonly concurrency = 3,
  ) {}

  /** Queues columns for a paper, merging with work already waiting for it. */
  add(paperId: string, columnIds: string[]): void {
    if (columnIds.length === 0) return;
    const existing = this.waiting.find((task) => task.paperId === paperId);
    if (existing) {
      for (const id of columnIds) if (!existing.columnIds.includes(id)) existing.columnIds.push(id);
    } else {
      this.waiting.push({ paperId, columnIds: [...columnIds] });
    }
    this.pump();
  }

  /** Drops waiting work for a paper (work already running finishes). */
  removePaper(paperId: string): void {
    this.waiting = this.waiting.filter((task) => task.paperId !== paperId);
  }

  /** Drops a column from all waiting work. */
  removeColumn(columnId: string): void {
    for (const task of this.waiting) task.columnIds = task.columnIds.filter((id) => id !== columnId);
    this.waiting = this.waiting.filter((task) => task.columnIds.length > 0);
  }

  get size(): number {
    return this.waiting.length + this.active;
  }

  private pump(): void {
    while (this.active < this.concurrency && this.waiting.length > 0) {
      const task = this.waiting.shift()!;
      this.active++;
      this.run(task)
        .catch(() => {
          // `run` reports its own errors; a rejection must not stall the queue.
        })
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }
}
