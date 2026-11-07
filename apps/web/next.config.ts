import type { NextConfig } from "next";
const config: NextConfig = { transpilePackages: ["@wallscan/core", "@wallscan/i18n", "@wallscan/ui"], reactStrictMode: true };
export default config;
