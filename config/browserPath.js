const fs = require('fs');
const path = require('path');

function pathExists(filePath) {
  if (!filePath) return false;
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function resolveChromiumPath() {
  const configured = process.env.CHROMIUM_PATH?.trim();
  if (pathExists(configured)) {
    return configured;
  }

  if (configured) {
    console.warn(
      `[browser] CHROMIUM_PATH not found at "${configured}", trying fallbacks...`
    );
  }

  try {
    const puppeteer = require('puppeteer');
    const puppeteerPath = puppeteer.executablePath();
    if (pathExists(puppeteerPath)) {
      return puppeteerPath;
    }
  } catch (error) {
    console.warn('[browser] Could not resolve puppeteer executable:', error.message);
  }

  const systemCandidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium'
  ];

  for (const candidate of systemCandidates) {
    if (pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'No Chromium/Chrome executable found. Set CHROMIUM_PATH in .env or run: npx puppeteer browsers install chrome'
  );
}

module.exports = { resolveChromiumPath };
