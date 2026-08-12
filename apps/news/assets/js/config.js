// News API configuration
// No-key sources (already active): OKSURF, Noozra, Hacker News, Spaceflight News,
// BBC (via rss2json), dev.to, and curated RSS feeds (Guardian, Al Jazeera, The
// Verge, Ars Technica, TechCrunch, CoinDesk, ScienceDaily, NPR, ESPN, Billboard).
//
// Optional free-tier API keys — paste a real key into a slot below to enable that
// source. All listed services send CORS headers, so they work from the browser.
//   GNews:     free key at https://gnews.io/                        (100 req/day free)
//   NewsData:  free key at https://newsdata.io/                     (200 req/day free)
//   Currents:  free key at https://currentsapi.services/en/         (300 req/day free)
//   Mediastack:free key at https://mediastack.com/                  (500 req/month free)
//   rss2json:  free key at https://rss2json.com/                    (raises the 25-feed cap)
// Services NOT usable from the browser (no CORS): NewsAPI.org, Guardian API, NYT API.
export const NEWS_CONFIG = {
  GNEWS_API_KEY: 'YOUR_GNEWS_API_KEY_HERE',
  NEWSDATA_API_KEY: 'YOUR_NEWSDATA_API_KEY_HERE',
  CURRENTS_API_KEY: 'YOUR_CURRENTS_API_KEY_HERE',
  MEDIASTACK_API_KEY: 'YOUR_MEDIASTACK_API_KEY_HERE',
  RSS2JSON_API_KEY: 'YOUR_RSS2JSON_API_KEY_HERE',
};
