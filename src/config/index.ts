import dotenv from "dotenv";
import { AppConfig, GemmaConfig, SmtpConfig } from "../types";

dotenv.config({ quiet: true }); // Load environment variables from .env file

const getNyaaUrl = (): string => {
  return process.env.NYAA_URL || "https://nyaa.si";
};

const getSukebeiUrl = (): string => {
  return process.env.SUKEBEI_URL || "https://sukebei.nyaa.si";
};

const getDownloadFolder = (): string => {
  return process.env.DOWNLOAD_FOLDER || "";
};

const getSmtpConfig = (): SmtpConfig => {
  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true" || false,
    user: process.env.SMTP_USER || "",
    password: process.env.SMTP_PASSWORD || "",
  };
};

const getReportEmail = (): string => {
  return process.env.RECIPIENT_EMAIL || "";
};

const getFromEmail = (): string => {
  const from = process.env.FROM_EMAIL || "";
  return `"Nyaa Downloader" <${from}>`;
};

const getGemmaConfig = (): GemmaConfig => {
  return {
    apiUrl: process.env.GEMMA_API_URL || "http://127.0.0.1:11434/api/generate",
    model: process.env.GEMMA_MODEL || "gemma4:e4b",
    timeoutMs: parseInt(process.env.GEMMA_TIMEOUT_MS || "120000", 10),
  };
};

export const getAppConfig = (): AppConfig => {
  return {
    nyaaUrl: getNyaaUrl(),
    sukebeiUrl: getSukebeiUrl(),
    downloadFolder: getDownloadFolder(),
    smtp: getSmtpConfig(),
    reportEmail: getReportEmail(),
    fromEmail: getFromEmail(),
    gemma: getGemmaConfig(),
  };
};
