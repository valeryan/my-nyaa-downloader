import nodemailer from "nodemailer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAppConfig } from "../config";
import type { TrackerGroup } from "../types";
import { sendEmailReport } from "./email";

// Mock dependencies
vi.mock("../config", () => ({
  getAppConfig: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(),
  },
}));

describe("email service", () => {
  const mockConfig = {
    nyaaUrl: "https://nyaa.si",
    downloadFolder: "/downloads",
    smtp: {
      host: "smtp.test.com",
      port: 587,
      secure: false,
      user: "test@test.com",
      password: "password"
    },
    reportEmail: "report@test.com",
    fromEmail: "from@test.com"
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppConfig).mockReturnValue(mockConfig);
  });

  describe("sendEmailReport", () => {
    it("should send email report successfully", async () => {
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "test-id" });
      const mockTransporter = {
        sendMail: mockSendMail,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(nodemailer.createTransport).mockReturnValue(mockTransporter as any);

      const mockTrackerGroups: TrackerGroup = {
        "TestGroup": [
          {
            title: "Test Anime S01",
            newEpisodes: 2,
          },
          {
            title: "Another Anime S02",
            newEpisodes: 1,
          },
        ],
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await sendEmailReport(mockTrackerGroups);

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: "smtp.test.com",
        port: 587,
        secure: false,
        auth: {
          user: "test@test.com",
          pass: "password",
        },
      });

      expect(mockSendMail).toHaveBeenCalledWith({
        from: "from@test.com",
        to: "report@test.com",
        subject: "Nyaa Downloader Report - 3 new episode(s)",
        html: expect.stringContaining("Nyaa Downloader Report"),
      });

      expect(consoleSpy).toHaveBeenCalledWith("Email report sent successfully.");
      consoleSpy.mockRestore();
    });

    it("should handle email sending errors gracefully", async () => {
      const mockSendMail = vi.fn().mockRejectedValue(new Error("SMTP error"));
      const mockTransporter = {
        sendMail: mockSendMail,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(nodemailer.createTransport).mockReturnValue(mockTransporter as any);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const mockTrackerGroups: TrackerGroup = {
        "TestGroup": [],
      };

      await sendEmailReport(mockTrackerGroups);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Error sending email report:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it("should generate correct email content for empty groups", async () => {
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "test-id" });
      const mockTransporter = {
        sendMail: mockSendMail,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(nodemailer.createTransport).mockReturnValue(mockTransporter as any);

      const mockTrackerGroups: TrackerGroup = {
        "EmptyGroup": [],
      };

      await sendEmailReport(mockTrackerGroups);

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.subject).toBe("Nyaa Downloader Report - 0 new episode(s)");
      expect(callArgs.html).toContain("No new episodes found");
    });

    it("should use correct email configuration", async () => {
      const customConfig = {
        ...mockConfig,
        smtp: {
          host: "custom.smtp.com",
          port: 465,
          secure: true,
          user: "custom@test.com",
          password: "custompass",
        },
        reportEmail: "custom-report@test.com",
        fromEmail: "custom-from@test.com",
      };

      vi.mocked(getAppConfig).mockReturnValue(customConfig);

      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "test-id" });
      const mockTransporter = {
        sendMail: mockSendMail,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(nodemailer.createTransport).mockReturnValue(mockTransporter as any);

      const mockTrackerGroups: TrackerGroup = {
        "TestGroup": [
          {
            title: "Test Anime",
            newEpisodes: 1,
          },
        ],
      };

      await sendEmailReport(mockTrackerGroups);

      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: "custom.smtp.com",
        port: 465,
        secure: true,
        auth: {
          user: "custom@test.com",
          pass: "custompass",
        },
      });

      expect(mockSendMail).toHaveBeenCalledWith({
        from: "custom-from@test.com",
        to: "custom-report@test.com",
        subject: "Nyaa Downloader Report - 1 new episode(s)",
        html: expect.any(String),
      });
    });

    it("should generate correct HTML content structure", async () => {
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: "test-id" });
      const mockTransporter = {
        sendMail: mockSendMail,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(nodemailer.createTransport).mockReturnValue(mockTransporter as any);

      const mockTrackerGroups: TrackerGroup = {
        "Group1": [
          {
            title: "Anime 1",
            newEpisodes: 2,
          },
        ],
        "Group2": [
          {
            title: "Anime 2",
            newEpisodes: 1,
          },
        ],
      };

      await sendEmailReport(mockTrackerGroups);

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain("<h1>Nyaa Downloader Report</h1>");
      expect(callArgs.html).toContain("<h2>Group1</h2>");
      expect(callArgs.html).toContain("<h2>Group2</h2>");
      expect(callArgs.html).toContain("<li>Anime 1: 2 new episode(s)</li>");
      expect(callArgs.html).toContain("<li>Anime 2: 1 new episode(s)</li>");
    });
  });
});
