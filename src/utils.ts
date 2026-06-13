import { Channel } from "./types";

/**
 * Parses m3u text format into robust structured Channel arrays.
 */
export function parseM3U(data: string): Channel[] {
  const lines = data.split("\n");
  const parsedChannels: Channel[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#EXTINF")) {
      let url = "";
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (nextLine && !nextLine.startsWith("#")) {
          url = nextLine;
          break;
        }
      }

      if (!url) continue;

      // Extract channel name
      const nameParts = line.split(",");
      const name = nameParts[nameParts.length - 1].trim() || "Unknown Channel";

      // Extract logo
      let logo = "";
      const logoMatch = line.match(/tvg-logo="([^"]*)"/);
      if (logoMatch) {
        logo = logoMatch[1].trim();
      }

      // Extract categories
      let categories = ["Other"];
      const groupMatch = line.match(/group-title="([^"]*)"/);
      if (groupMatch) {
         const splitCats = groupMatch[1]
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean);
        if (splitCats.length > 0) {
          categories = splitCats;
        }
      }

      parsedChannels.push({
        name,
        url,
        logo,
        categories,
      });
    }
  }

  return parsedChannels;
}

/**
 * Gets the initials for beautiful placeholder avatars
 */
export function getInitials(name: string): string {
  if (!name) return "📺";
  const cleanName = name.replace(/[^\w\s]/gi, "").trim();
  const parts = cleanName.split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase().substring(0, 2);
  }
  return cleanName.substring(0, 2).toUpperCase() || "📺";
}

/**
 * Gets a beautiful unique gradient background for fallback avatars based on channel name hashes
 */
export function getFallbackGradient(name: string): string {
  const gradients = [
    "linear-gradient(135deg, #ff007f 0%, #7928ca 100%)", // Pink -> Purple
    "linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)", // Cyan -> Blue
    "linear-gradient(135deg, #00ff87 0%, #60efff 100%)", // Neon Green -> Light Cyan
    "linear-gradient(135deg, #f5576c 0%, #f093fb 100%)", // Red -> Pink
    "linear-gradient(135deg, #fa709a 0%, #fee140 100%)", // Pink -> Yellow
    "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)", // Green -> Mint
    "linear-gradient(135deg, #30cfd0 0%, #330867 100%)", // Blue -> Purple
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % gradients.length;
  return gradients[index];
}

/**
 * Computes live watcher count and total visits using exact specified equations
 * based on the benchmark date (2026-06-05) to remain fully synchronized across all client machines.
 */
export function calculateLiveStats(): { liveCount: number; totalCount: number } {
  const baseTime = new Date("2026-06-05T00:00:00Z").getTime();
  const now = Date.now();
  const elapsed = now - baseTime;

  // 1. Total Visits (steady tick growth: 1 visit every 90 seconds)
  const baseVisits = 9850;
  const visitIntervalMs = 90000;
  const totalCount = baseVisits + Math.max(0, Math.floor(elapsed / visitIntervalMs));

  // 2. Live Watching (Sine wave + high freq noise: slow wave cycles every ~62.8 min)
  const baseLive = 110;
  const slowWave = Math.sin(now / 600000) * 25; // Fluctuates +/- 25
  const fastNoise = Math.sin(now / 3183) * 4;     // Noise +/- 4
  let liveCount = Math.round(baseLive + slowWave + fastNoise);
  if (liveCount < 70) liveCount = 70;
  if (liveCount > 160) liveCount = 160;

  return { liveCount, totalCount };
}

/**
 * Sorts category lists in the client-determined custom rank
 */
export function sortCategories(cats: string[]): string[] {
  const customOrder = [
    "sports",
    "bangla",
    "news",
    "kids",
    "indian bangla",
    "entertainment",
    "movies",
    "english",
    "religious",
    "hindi",
    "infotainment",
    "musics",
    "drama",
    "weather",
    "other",
  ];

  return [...cats].sort((a, b) => {
    const aIndex = customOrder.indexOf(a.toLowerCase().trim());
    const bIndex = customOrder.indexOf(b.toLowerCase().trim());

    const aVal = aIndex !== -1 ? aIndex : 999;
    const bVal = bIndex !== -1 ? bIndex : 999;

    if (aVal !== bVal) {
      return aVal - bVal;
    }
    return a.localeCompare(b);
  });
}
