/* eslint-disable @typescript-eslint/no-explicit-any */
const divider = "----------------------------------------";

type LogLevel = "error" | "warn" | "info" | "debug";

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const getLogLevel = (): LogLevel => {
  const level = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
  return LOG_LEVELS[level] !== undefined ? level : "info";
};

const currentLogLevel = LOG_LEVELS[getLogLevel()];

const shouldLog = (level: LogLevel): boolean => {
  return LOG_LEVELS[level] <= currentLogLevel;
};

const header = (message: string) => {
  log(divider);
  log(message);
  log(divider);
};

const log = (message?: any, ...optionalParams: any[]) => {
  console.log(message, optionalParams.length ? optionalParams : "");
};

const info = (message?: any, ...optionalParams: any[]) => {
  if (shouldLog("info")) {
    console.log(message, optionalParams.length ? optionalParams : "");
  }
};

const warn = (message?: any, ...optionalParams: any[]) => {
  if (shouldLog("warn")) {
    console.warn(message, optionalParams.length ? optionalParams : "");
  }
};

const debug = (message?: any, ...optionalParams: any[]) => {
  if (shouldLog("debug")) {
    console.debug(message, optionalParams.length ? optionalParams : "");
  }
};

const error = (message?: any, ...optionalParams: any[]) => {
  if (shouldLog("error")) {
    console.error(message, optionalParams);
  }
};

export const logger = {
  debug,
  error,
  header,
  info,
  log,
  warn,
};
