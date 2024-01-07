/* eslint-disable @typescript-eslint/no-explicit-any */
const divider = "----------------------------------------";

const header = (message: string) => {
  info(divider);
  info(message);
  info(divider);
};

const info = (message?: any, ...optionalParams: any[]) => {
  console.log(message, optionalParams.length ? optionalParams : "");
};

const error = (message?: any, ...optionalParams: any[]) => {
  console.error(message, optionalParams);
};

export const logger = {
  error,
  header,
  info,
};
