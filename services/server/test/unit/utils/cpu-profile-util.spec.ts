import { expect } from "chai";
import type { CpuProfile } from "../../../src/server/services/utils/cpu-profile-util";
import {
  shortenUrl,
  summarizeCpuProfile,
} from "../../../src/server/services/utils/cpu-profile-util";

// Shape of worker.startCpuProfile() output: (root) -> main -> ipfsHash,
// plus V8's special nodes. lineNumber is 0-based, positionTicks are 1-based.
const profile: CpuProfile = {
  nodes: [
    {
      id: 1,
      callFrame: { functionName: "(root)", url: "", lineNumber: -1 },
      children: [2, 5, 6],
    },
    {
      id: 2,
      callFrame: {
        functionName: "main",
        url: "/app/services/server/dist/server/x.js",
        lineNumber: 10,
      },
      children: [3, 4],
    },
    {
      id: 3,
      callFrame: {
        functionName: "ipfsHash",
        url: "file:///app/node_modules/pkg/lib/a.js",
        lineNumber: 41,
      },
      positionTicks: [
        { line: 50, ticks: 2 },
        { line: 42, ticks: 6 },
      ],
    },
    {
      id: 4,
      callFrame: { functionName: "", url: "", lineNumber: 0 },
    },
    {
      id: 5,
      callFrame: {
        functionName: "(garbage collector)",
        url: "",
        lineNumber: -1,
      },
    },
    {
      id: 6,
      callFrame: { functionName: "(program)", url: "", lineNumber: -1 },
    },
  ],
  samples: [3, 3, 3, 3, 3, 3, 3, 3, 4, 2, 5, 6],
  timeDeltas: new Array(12).fill(1000),
  startTime: 0,
  endTime: 12000,
};

describe("cpu-profile-util", function () {
  describe("shortenUrl", function () {
    it("keeps the path from node_modules, dist or src on", function () {
      expect(shortenUrl("file:///app/node_modules/pkg/lib/a.js")).to.equal(
        "node_modules/pkg/lib/a.js",
      );
      expect(shortenUrl("/app/services/server/dist/server/x.js")).to.equal(
        "dist/server/x.js",
      );
      expect(shortenUrl("/app/services/server/src/server/x.ts")).to.equal(
        "src/server/x.ts",
      );
      expect(shortenUrl("node:internal/worker")).to.equal(
        "node:internal/worker",
      );
    });
  });

  describe("summarizeCpuProfile", function () {
    it("ranks frames by self samples with 1-based lines and hot lines", function () {
      const summary = summarizeCpuProfile(profile, 20);

      expect(summary.sampleCount).to.equal(12);
      expect(summary.topSelf).to.have.length(3);
      expect(summary.topSelf[0]).to.deep.equal({
        fn: "ipfsHash",
        url: "node_modules/pkg/lib/a.js",
        line: 42,
        pct: 66.7,
        hotLines: [
          { line: 42, ticks: 6 },
          { line: 50, ticks: 2 },
        ],
      });
      expect(summary.topSelf[1]).to.deep.include({
        fn: "(anonymous)",
        url: "",
        line: 1,
        pct: 8.3,
        hotLines: [],
      });
      expect(summary.topSelf[2]).to.deep.include({
        fn: "main",
        url: "dist/server/x.js",
        line: 11,
        pct: 8.3,
      });
    });

    it("builds stacks from leaf to root without the (root) node", function () {
      const summary = summarizeCpuProfile(profile, 20);

      expect(summary.topStacks[0]).to.deep.equal({
        pct: 66.7,
        stack:
          "ipfsHash node_modules/pkg/lib/a.js:42 < main dist/server/x.js:11",
      });
      expect(summary.topStacks.map((s) => s.stack)).to.include(
        "(anonymous) < main dist/server/x.js:11",
      );
      expect(summary.topStacks.map((s) => s.stack)).to.include(
        "main dist/server/x.js:11",
      );
    });

    it("reports the special nodes separately", function () {
      const summary = summarizeCpuProfile(profile, 20);

      expect(summary.special).to.deep.equal({
        garbageCollector: 8.3,
        idle: 0,
        program: 8.3,
      });
      const names = summary.topSelf.map((f) => f.fn);
      expect(names).to.not.include("(garbage collector)");
      expect(names).to.not.include("(program)");
    });

    it("limits frames and stacks to topN", function () {
      const summary = summarizeCpuProfile(profile, 1);

      expect(summary.topSelf).to.have.length(1);
      expect(summary.topStacks).to.have.length(1);
      expect(summary.topSelf[0].fn).to.equal("ipfsHash");
    });

    it("truncates very deep stacks", function () {
      const depth = 40;
      const nodes: CpuProfile["nodes"] = [
        {
          id: 1,
          callFrame: { functionName: "(root)", url: "", lineNumber: -1 },
          children: [2],
        },
      ];
      for (let id = 2; id <= depth + 1; id++) {
        nodes.push({
          id,
          callFrame: { functionName: `f${id}`, url: "", lineNumber: 0 },
          children: id < depth + 1 ? [id + 1] : undefined,
        });
      }
      const summary = summarizeCpuProfile({ nodes, samples: [depth + 1] }, 20);

      const frames = summary.topStacks[0].stack.split(" < ");
      expect(frames).to.have.length(26);
      expect(frames[0]).to.equal(`f${depth + 1}`);
      expect(frames[25]).to.equal("...");
    });

    it("handles an empty profile", function () {
      const summary = summarizeCpuProfile({ nodes: [], samples: [] }, 20);

      expect(summary).to.deep.equal({
        sampleCount: 0,
        topSelf: [],
        topStacks: [],
        special: { garbageCollector: 0, idle: 0, program: 0 },
      });
    });
  });
});
