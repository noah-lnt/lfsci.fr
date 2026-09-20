import { getRequestConfig } from "next-intl/server";
import { messages } from "./messages";

export const locale = "fr";
export const timeZone = "Europe/Paris";

export default getRequestConfig(async () => ({ locale, timeZone, messages }));
