import { describe, expect, it } from "vitest";
import { ExtractionQueue, type ExtractionTask } from "@/lib/extraction-queue";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ExtractionQueue", () => {
  it("runs at most `concurrency` tasks at once, then drains", async () => {
    const started: ExtractionTask[] = [];
    const gates: ReturnType<typeof deferred>[] = [];
    const queue = new ExtractionQueue((task) => {
      started.push(task);
      const gate = deferred();
      gates.push(gate);
      return gate.promise;
    }, 2);

    for (const id of ["p1", "p2", "p3", "p4"]) queue.add(id, ["c1"]);
    expect(started.map((t) => t.paperId)).toEqual(["p1", "p2"]);
    expect(queue.size).toBe(4);

    gates[0].resolve();
    await tick();
    expect(started.map((t) => t.paperId)).toEqual(["p1", "p2", "p3"]);

    gates[1].resolve();
    gates[2].resolve();
    await tick();
    gates[3].resolve();
    await tick();
    expect(started).toHaveLength(4);
    expect(queue.size).toBe(0);
  });

  it("merges columns for a paper that is still waiting", () => {
    const started: ExtractionTask[] = [];
    const queue = new ExtractionQueue((task) => {
      started.push(task);
      return new Promise(() => {});
    }, 1);
    queue.add("busy", ["c1"]);
    queue.add("p1", ["c1"]);
    queue.add("p1", ["c2", "c1"]);
    expect(queue.size).toBe(2);
    expect(started).toHaveLength(1);
  });

  it("drops waiting work for removed papers and columns", async () => {
    const started: ExtractionTask[] = [];
    const gate = deferred();
    const queue = new ExtractionQueue((task) => {
      started.push(task);
      return started.length === 1 ? gate.promise : Promise.resolve();
    }, 1);
    queue.add("busy", ["c1"]);
    queue.add("p1", ["c1"]);
    queue.add("p2", ["c1", "c2"]);
    queue.add("p3", ["c2"]);
    queue.removePaper("p1");
    queue.removeColumn("c2");

    gate.resolve();
    await tick();
    await tick();
    expect(started.map((t) => [t.paperId, t.columnIds])).toEqual([
      ["busy", ["c1"]],
      ["p2", ["c1"]],
    ]);
  });

  it("ignores empty column lists", () => {
    const queue = new ExtractionQueue(async () => {});
    queue.add("p1", []);
    expect(queue.size).toBe(0);
  });

  it("keeps going after a task rejects", async () => {
    const started: string[] = [];
    const queue = new ExtractionQueue(async (task) => {
      started.push(task.paperId);
      if (task.paperId === "bad") throw new Error("boom");
    }, 1);
    queue.add("bad", ["c1"]);
    queue.add("good", ["c1"]);
    await tick();
    await tick();
    expect(started).toEqual(["bad", "good"]);
  });
});
