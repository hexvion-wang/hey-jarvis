// HEX 天氣卡：向 Open-Meteo（免費、不用帳號）查天氣，只送出城市座標。15 分鐘快取一次。

export interface WeatherPlace {
  name: string;
  lat: number;
  lon: number;
}

/** 預設台中；可以在 jarvis.config.json 加 "weather": { "name": "...", "lat": ..., "lon": ... } 改 */
export const DEFAULT_PLACE: WeatherPlace = { name: '台中', lat: 24.1477, lon: 120.6736 };

const CACHE_MS = 15 * 60 * 1000;
let cache: { at: number; key: string; data: unknown } | null = null;

export async function getWeather(place: WeatherPlace) {
  const key = `${place.lat},${place.lon}`;
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.data;
  const q = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    forecast_hours: '10',
    timezone: 'Asia/Taipei',
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`open-meteo ${r.status}`);
  const j: any = await r.json();
  const c = j.current;
  const h = j.hourly;
  const data = {
    city: place.name,
    current: {
      temp: c.temperature_2m,
      feels: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      wind: c.wind_speed_10m,
      code: c.weather_code,
      isDay: c.is_day === 1,
    },
    hourly: (h.time as string[]).map((time, i) => ({
      time: time.slice(11, 16),
      temp: h.temperature_2m[i],
      code: h.weather_code[i],
      pop: h.precipitation_probability[i] ?? 0,
      isDay: h.is_day[i] === 1,
    })),
  };
  cache = { at: Date.now(), key, data };
  return data;
}
