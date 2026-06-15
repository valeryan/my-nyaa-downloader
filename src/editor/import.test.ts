import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAppConfig } from "../config";
import { scrapeNyaaViewPage } from "../services/nyaa";
import type { ImportSuggestionContext } from "../types";
import { createGemmaImportSuggestionProvider, createImportFromLinkService } from "./import";

vi.mock("../config", () => ({
  getAppConfig: vi.fn(),
}));

global.fetch = vi.fn();

describe("editor import service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppConfig).mockReturnValue({
      nyaaUrl: "https://nyaa.si",
      sukebeiUrl: "https://sukebei.nyaa.si",
      downloadFolder: "/downloads",
      smtp: {
        host: "smtp.test.com",
        port: 587,
        secure: false,
        user: "test@test.com",
        password: "password",
      },
      reportEmail: "report@test.com",
      fromEmail: "from@test.com",
      gemma: {
        apiUrl: "http://127.0.0.1:11434/api/generate",
        model: "gemma4:e4b",
        timeoutMs: 1000,
      },
    });
  });

  it("scrapes a torrent view page and normalizes anonymous submitters", async () => {
    const html = `
      <div class="panel-title">[SubsPlease] Example Show - 01 [1080p]</div>
      <a href="/?c=1_2">Anime - English-translated</a>
      <a href="magnet:?xt=urn:btih:test">Magnet</a>
      <div id="torrent-description">A messy description for the AI to interpret.</div>
      <div class="panel-body">
        <div class="row">
          <div class="col-md-1">Submitter:</div>
          <div class="col-md-5">Anonymous</div>
        </div>
        <div class="row">
          <div class="col-md-1">Size:</div>
          <div class="col-md-5">1.5 GiB</div>
        </div>
      </div>
    `;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(html),
    } as unknown as Response);

    const result = await scrapeNyaaViewPage("https://nyaa.si/view/1359919");

    expect(result.uploader).toBe("Anonymous");
    expect(result.infoRows.Submitter).toBe("Anonymous");
    expect(result.infoRows.Size).toBe("1.5 GiB");
  });

  it("maps Sukebei links to Ecchi and season packs without placement AI", async () => {
    const html = `
      <div class="panel-title">[Uploader] Example Release</div>
      <a href="/?c=1_2">Anime</a>
      <a href="/user/Uploader">Uploader</a>
      <a href="magnet:?xt=urn:btih:test">Magnet</a>
    `;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(html),
    } as unknown as Response);

    const provider = {
      generatePlacementSuggestion: vi.fn(),
      generateFolderSuggestion: vi.fn().mockResolvedValue({
        folder: "Example Show",
        query: "Example Show",
        reasons: {
          folder: "The title data points to 'Example Show'.",
          query: "This is the shortest reliable title substring for Nyaa search.",
        },
      }),
      generatePatternSuggestion: vi.fn().mockResolvedValue({}),
    };

    const service = createImportFromLinkService({
      provider,
      inspectTorrentFiles: vi.fn().mockResolvedValue(["Episode 01.mkv", "Episode 02.mkv"]),
    });

    const result = await service("https://sukebei.nyaa.si/view/2468", ["Anime", "Ecchi"]);

    expect(provider.generatePlacementSuggestion).not.toHaveBeenCalled();
    expect(result.suggestedGroup).toBe("Ecchi");
    expect(result.suggestedSection).toBe("seasonPacks");
    expect(result.fields.uploader).toBe("Uploader");
    expect(result.fields.folder).toBe("Example Show");
    expect(result.fields.query).toBe("Example Show");
  });

  it("defaults normal Nyaa imports to Anime when category AI does not move them", async () => {
    const html = `
      <div class="panel-title">[Group] Example Show</div>
      <a href="/?c=1_2">Anime</a>
      <a href="/user/Group">Group</a>
      <a href="magnet:?xt=urn:btih:test">Magnet</a>
      <div id="torrent-description">Standard anime description.</div>
      <div class="torrent-file-list panel-body">
        <ul>
          <li><i class="fa fa-file"></i>Episode 01.mkv <span class="file-size">(1 MiB)</span></li>
        </ul>
      </div>
    `;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(html),
    } as unknown as Response);

    const provider = {
      generatePlacementSuggestion: vi.fn().mockResolvedValue({
        isEcchi: false,
        reasons: {
          placement: "The title and description do not indicate adult content.",
        },
      }),
      generateFolderSuggestion: vi.fn().mockResolvedValue({
        folder: "Example Show",
        query: "Example Show",
      }),
      generatePatternSuggestion: vi.fn().mockResolvedValue({}),
    };

    const service = createImportFromLinkService({
      provider,
      inspectTorrentFiles: vi.fn(),
    });

    const result = await service("https://nyaa.si/view/1359919", ["Anime", "Ecchi"]);

    expect(provider.generatePlacementSuggestion).toHaveBeenCalled();
    expect(result.suggestedGroup).toBe("Anime");
    expect(result.suggestedSection).toBe("regular");
    expect(result.reasons?.placement).toContain("do not indicate adult content");
  });

  it("moves normal Nyaa imports to Ecchi only when category AI says so", async () => {
    const html = `
      <div class="panel-title">[Group] Adult Example Show</div>
      <a href="/?c=1_2">Anime</a>
      <a href="/user/Group">Group</a>
      <a href="magnet:?xt=urn:btih:test">Magnet</a>
      <div id="torrent-description">Explicit adult ecchi release.</div>
    `;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(html),
    } as unknown as Response);

    const provider = {
      generatePlacementSuggestion: vi.fn().mockResolvedValue({
        isEcchi: true,
        reasons: {
          placement: "The description explicitly says adult ecchi release.",
        },
      }),
      generateFolderSuggestion: vi.fn().mockResolvedValue({
        folder: "Adult Example Show",
        query: "Adult Example Show",
      }),
      generatePatternSuggestion: vi.fn().mockResolvedValue({}),
    };

    const service = createImportFromLinkService({
      provider,
      inspectTorrentFiles: vi.fn(),
    });

    const result = await service("https://nyaa.si/view/1359919", ["Anime", "Ecchi"]);

    expect(result.suggestedGroup).toBe("Ecchi");
    expect(result.reasons?.placement).toContain("adult ecchi");
  });

  it("leaves folder and query blank when AI returns empty values", async () => {
    const html = `
      <div class="panel-title">[Group] Example Show</div>
      <a href="/?c=1_2">Anime</a>
      <a href="/user/Group">Group</a>
      <a href="magnet:?xt=urn:btih:test">Magnet</a>
    `;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(html),
    } as unknown as Response);

    const provider = {
      generatePlacementSuggestion: vi.fn().mockResolvedValue({ isEcchi: false }),
      generateFolderSuggestion: vi.fn().mockResolvedValue({
        folder: "   ",
        query: "",
      }),
      generatePatternSuggestion: vi.fn().mockResolvedValue({}),
    };

    const service = createImportFromLinkService({
      provider,
      inspectTorrentFiles: vi.fn(),
    });

    const result = await service("https://nyaa.si/view/1359919", ["Anime", "Ecchi"]);

    expect(result.fields.folder).toBe("");
    expect(result.fields.query).toBe("");
  });


  it("accepts folder/query reasons returned as a single string", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        response: JSON.stringify({
          folder: "The Vexations of a Shut-In Vampire Princess",
          query: "[Sav1or] Hikikomari Kyuuketsuki no Monmon",
          reasons: "The folder should use the clear English title, and the query should keep the leading release tag while stopping before later release metadata.",
          warnings: "",
        }),
      }),
    } as unknown as Response);

    const provider = createGemmaImportSuggestionProvider();
    const result = await provider.generateFolderSuggestion?.({
      viewPage: {
        url: "https://nyaa.si/view/1359919",
        sourceSite: "nyaa",
        title: "[Sav1or] Hikikomari Kyuuketsuki no Monmon (The Vexations of a Shut-In Vampire Princess) Complete [BD][1080p][AV1][OPUS][Dual Audio]",
        uploader: "Anonymous",
        category: "Anime",
        magnetLink: "magnet:?xt=urn:btih:test",
        infoRows: {},
        description: "",
        fileList: ["Episode 01.mkv", "Episode 02.mkv"],
      },
      torrentFiles: [],
      allowedGroups: ["Anime", "Ecchi"],
      defaultGroup: "Anime",
    } satisfies ImportSuggestionContext);

    expect(result?.reasons?.folder).toContain("clear English title");
    expect(result?.reasons?.query).toContain("leading release tag");
    expect(result?.warnings).toEqual([]);
  });

  it("accepts folder/query reasons returned at the top level", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        response: JSON.stringify({
          folder: "The Vexations of a Shut-In Vampire Princess",
          query: "[Sav1or] Hikikomari Kyuuketsuki no Monmon",
          folderReason: "The raw title contains the clear English title in parentheses, so the folder uses only that English series title.",
          queryReason: "The query keeps the leading release tag and main title substring, but stops before the parenthetical alternate title and later release metadata.",
        }),
      }),
    } as unknown as Response);

    const provider = createGemmaImportSuggestionProvider();
    const result = await provider.generateFolderSuggestion?.({
      viewPage: {
        url: "https://nyaa.si/view/1359919",
        sourceSite: "nyaa",
        title: "[Sav1or] Hikikomari Kyuuketsuki no Monmon (The Vexations of a Shut-In Vampire Princess) Complete [BD][1080p][AV1][OPUS][Dual Audio]",
        uploader: "Anonymous",
        category: "Anime",
        magnetLink: "magnet:?xt=urn:btih:test",
        infoRows: {},
        description: "",
        fileList: ["Episode 01.mkv", "Episode 02.mkv"],
      },
      torrentFiles: [],
      allowedGroups: ["Anime", "Ecchi"],
      defaultGroup: "Anime",
    } satisfies ImportSuggestionContext);

    expect(result?.reasons?.folder).toContain("clear English title in parentheses");
    expect(result?.reasons?.query).toContain("leading release tag");
    expect(result?.warnings).toEqual([]);
  });

  it("does not invent folder/query reasons when AI omits them", async () => {
    const html = `
      <div class="panel-title">[Sav1or] Hikikomari Kyuuketsuki no Monmon (The Vexations of a Shut-In Vampire Princess) Complete [BD][1080p][AV1][OPUS][Dual Audio]</div>
      <a href="/?c=1_2">Anime</a>
      <a href="magnet:?xt=urn:btih:test">Magnet</a>
      <div class="torrent-file-list panel-body">
        <ul>
          <li><i class="fa fa-file"></i>Episode 01.mkv <span class="file-size">(1 MiB)</span></li>
          <li><i class="fa fa-file"></i>Episode 02.mkv <span class="file-size">(1 MiB)</span></li>
        </ul>
      </div>
    `;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(html),
    } as unknown as Response);

    const provider = {
      generatePlacementSuggestion: vi.fn().mockResolvedValue({ isEcchi: false }),
      generateFolderSuggestion: vi.fn().mockResolvedValue({
        folder: "The Vexations of a Shut-In Vampire Princess",
        query: "[Sav1or] Hikikomari Kyuuketsuki no Monmon",
      }),
      generatePatternSuggestion: vi.fn().mockResolvedValue({}),
    };

    const service = createImportFromLinkService({
      provider,
      inspectTorrentFiles: vi.fn(),
    });

    const result = await service("https://nyaa.si/view/1359919", ["Anime", "Ecchi"]);

    expect(result.fields.folder).toBe("The Vexations of a Shut-In Vampire Princess");
    expect(result.fields.query).toBe("[Sav1or] Hikikomari Kyuuketsuki no Monmon");
    expect(result.reasons?.folder).toBeUndefined();
    expect(result.reasons?.query).toBeUndefined();
    expect(result.warnings).toContain("AI returned folder without a reason.");
    expect(result.warnings).toContain("AI returned query without a reason.");

  });

  it("skips custom pattern AI when built-in patterns already match", async () => {
    const html = `
      <div class="panel-title">[Group] Example Show</div>
      <a href="/?c=1_2">Anime</a>
      <a href="/user/Group">Group</a>
      <a href="magnet:?xt=urn:btih:test">Magnet</a>
      <div class="torrent-file-list panel-body">
        <ul>
          <li><i class="fa fa-file"></i>Example Show - 01.mkv <span class="file-size">(1 MiB)</span></li>
          <li><i class="fa fa-file"></i>Example Show - 02.mkv <span class="file-size">(1 MiB)</span></li>
        </ul>
      </div>
    `;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(html),
    } as unknown as Response);

    const provider = {
      generatePlacementSuggestion: vi.fn().mockResolvedValue({ isEcchi: false }),
      generateFolderSuggestion: vi.fn().mockResolvedValue({
        folder: "Example Show",
        query: "Example Show",
      }),
      generatePatternSuggestion: vi.fn(),
    };

    const service = createImportFromLinkService({
      provider,
      inspectTorrentFiles: vi.fn(),
    });

    const result = await service("https://nyaa.si/view/1359919", ["Anime", "Ecchi"]);

    expect(provider.generatePatternSuggestion).not.toHaveBeenCalled();
    expect(result.fields.pattern).toBeUndefined();
  });

  it("asks for a custom pattern when built-ins do not match and leaves invalid output blank", async () => {
    const html = `
      <div class="panel-title">[Group] Example Show</div>
      <a href="/?c=1_2">Anime</a>
      <a href="/user/Group">Group</a>
      <a href="magnet:?xt=urn:btih:test">Magnet</a>
      <div class="torrent-file-list panel-body">
        <ul>
          <li><i class="fa fa-file"></i>SeasonA-PartB.mkv <span class="file-size">(1 MiB)</span></li>
          <li><i class="fa fa-file"></i>SeasonA-PartC.mkv <span class="file-size">(1 MiB)</span></li>
        </ul>
      </div>
    `;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(html),
    } as unknown as Response);

    const provider = {
      generatePlacementSuggestion: vi.fn().mockResolvedValue({ isEcchi: false }),
      generateFolderSuggestion: vi.fn().mockResolvedValue({
        folder: "Example Show",
        query: "Example Show",
      }),
      generatePatternSuggestion: vi.fn().mockResolvedValue({
        pattern: "(",
        reasons: {
          pattern: "The sampled titles need a custom regex.",
        },
      }),
    };

    const service = createImportFromLinkService({
      provider,
      inspectTorrentFiles: vi.fn(),
    });

    const result = await service("https://nyaa.si/view/1359919", ["Anime", "Ecchi"]);

    expect(provider.generatePatternSuggestion).toHaveBeenCalled();
    expect(result.fields.pattern).toBeUndefined();
    expect(result.warnings).toContain("Pattern suggestion was invalid and was left blank.");
  });

  it("rejects malformed Gemma placement responses", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ response: JSON.stringify({ isEcchi: "nope" }) }),
    } as unknown as Response);

    const provider = createGemmaImportSuggestionProvider();

    await expect(
      provider.generatePlacementSuggestion?.({
        viewPage: {
          url: "https://nyaa.si/view/1359919",
          sourceSite: "nyaa",
          title: "Example Show",
          uploader: "SubsPlease",
          category: "Anime",
          magnetLink: "",
          infoRows: {},
          description: "",
          fileList: [],
        },
        torrentFiles: [],
        allowedGroups: ["Anime", "Ecchi"],
        defaultGroup: "Anime",
      } satisfies ImportSuggestionContext),
    ).rejects.toThrow("Gemma returned a malformed placement payload.");
  });
});
