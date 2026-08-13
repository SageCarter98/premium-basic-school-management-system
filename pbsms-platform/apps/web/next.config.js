/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // FR-UX-010 (Chapter 34.3): installable PWA on Android. Add next-pwa (or
  // an equivalent service-worker setup) here as an early Phase 1/2 task —
  // deliberately not pre-wired in this scaffold so the team chooses and
  // reviews the offline-caching strategy deliberately, rather than
  // inheriting a default from a scaffold nobody read closely.
};

module.exports = nextConfig;
